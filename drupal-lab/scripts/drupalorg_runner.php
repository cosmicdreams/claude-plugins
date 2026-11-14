<?php
// The Python adapter supplies $request through a private transient file, never argv.
declare(strict_types=1);

function redact(string $text, array $secrets): string {
    foreach ($secrets as $secret) {
        if (is_string($secret) && $secret !== '') {
            $text = str_replace($secret, '[redacted]', $text);
        }
    }
    return $text;
}

try {
    $token = $request['token'] ?? getenv('DRUPALORG_GITLAB_TOKEN') ?: null;
    $secrets = [$token];
    if ($request['kind'] === 'cli') {
        if (hash_file('sha256', $request['phar']) !== $request['phar_sha256']) {
            throw new RuntimeException('Unsupported or unverified PHAR; run the pinned installer');
        }
        $env = getenv();
        if ($token) {
            $env['DRUPALORG_GITLAB_TOKEN'] = $token;
        }
        $temporary = [];
        foreach ($request['files'] ?? [] as $index => $encoded) {
            $file = tempnam('/tmp', 'drupalorg-note-');
            chmod($file, 0600);
            file_put_contents($file, base64_decode($encoded, true));
            $request['args'][$index] = '--file=' . $file;
            $temporary[] = $file;
        }
        $process = proc_open(
            array_merge(['php', $request['phar']], $request['args']),
            [0 => ['file', '/dev/null', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes, '/tmp', $env
        );
        if (!is_resource($process)) {
            throw new RuntimeException('Cannot launch drupalorg-cli');
        }
        // Drain both streams concurrently so a large diff cannot deadlock on stderr.
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        $stdout = $stderr = '';
        $start = microtime(true);
        do {
            $stdout .= stream_get_contents($pipes[1]);
            $stderr .= stream_get_contents($pipes[2]);
            $status = proc_get_status($process);
            if (microtime(true) - $start > $request['timeout']) {
                proc_terminate($process, 9);
                throw new RuntimeException('CLI timed out');
            }
            if ($status['running']) {
                usleep(10000);
            }
        } while ($status['running']);
        $stdout .= stream_get_contents($pipes[1]);
        $stderr .= stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $code = proc_close($process);
        if ($code === -1) {
            $code = $status['exitcode'];
        }
        foreach ($temporary as $file) {
            unlink($file);
        }
        $result = ['ok' => $code === 0, 'code' => $code,
            'stdout' => redact($stdout, $secrets), 'stderr' => redact($stderr, $secrets)];
    } elseif ($request['kind'] === 'http') {
        $url = $request['url'];
        $host = parse_url($url, PHP_URL_HOST);
        if (parse_url($url, PHP_URL_SCHEME) !== 'https'
            || !in_array($host, ['www.drupal.org', 'git.drupalcode.org'], true)
            || parse_url($url, PHP_URL_USER) !== null) {
            throw new RuntimeException('Unsupported upstream URL');
        }
        $headers = [];
        $curl = curl_init($url);
        $sent = ['Accept: application/json', 'User-Agent: drupal-lab'];
        if ($token && $host === 'git.drupalcode.org') {
            $sent[] = 'PRIVATE-TOKEN: ' . $token;
        }
        curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $request['timeout'], CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_HTTPHEADER => $sent,
            CURLOPT_HEADERFUNCTION => static function ($curl, $line) use (&$headers) {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return strlen($line);
            }]);
        $body = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_HTTP_CODE);
        if ($body === false) {
            throw new RuntimeException('Upstream transport failed: ' . curl_error($curl));
        }
        $result = ['ok' => $status >= 200 && $status < 300, 'status' => $status,
            'headers' => $headers, 'body' => redact($body, $secrets)];
    } else {
        throw new RuntimeException('Unsupported runner operation');
    }
    echo json_encode($result, JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    foreach ($temporary ?? [] as $file) {
        if (is_file($file)) {
            unlink($file);
        }
    }
    echo json_encode(['ok' => false, 'error' => redact($e->getMessage(), $secrets ?? [])]);
}
