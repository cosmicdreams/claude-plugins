<?php
/**
 * Parse an xhprof data file and output top-10 functions as JSON.
 *
 * Usage: php parse-xhprof.php <xhprof-file>
 *
 * Intentional autoresearch target — this script's parsing performance is measurable.
 *
 * All values are inclusive (include callees).
 */

if ($argc < 2) {
    fwrite(STDERR, "Usage: php parse-xhprof.php <xhprof-file>\n");
    exit(1);
}

$file = $argv[1];
if (!file_exists($file)) {
    fwrite(STDERR, "File not found: $file\n");
    exit(1);
}

// Load xhprof libraries from DDEV's built-in xhprof extension.
$xhprof_lib = '/var/xhprof/xhprof_lib/utils/xhprof_lib.php';
$xhprof_runs = '/var/xhprof/xhprof_lib/utils/xhprof_runs.php';

if (!file_exists($xhprof_lib)) {
    fwrite(STDERR, "xhprof_lib not found at $xhprof_lib — is ddev xhprof on?\n");
    exit(1);
}

require_once $xhprof_lib;
require_once $xhprof_runs;

// Read raw xhprof data (PHP serialized format).
$raw = unserialize(file_get_contents($file));
if ($raw === false) {
    fwrite(STDERR, "Failed to unserialize xhprof data from $file\n");
    exit(1);
}

// Compute flat call info (aggregates inclusive metrics per function).
$flat = xhprof_compute_flat_info($raw, $possible_metrics);

// Sort by wall time descending.
uasort($flat, fn($a, $b) => $b['wt'] <=> $a['wt']);

// Extract top-10.
$top10 = array_slice($flat, 0, 10, true);

// Build callgraph entries.
$callgraph = [];
foreach ($top10 as $fn => $metrics) {
    $callgraph[] = [
        'fn'     => $fn,
        'wt_ms'  => round($metrics['wt'] / 1000),
        'ct'     => $metrics['ct'],
        'cpu_ms' => round(($metrics['cpu'] ?? 0) / 1000),
        'mu_kb'  => round(($metrics['mu'] ?? 0) / 1024),
        'pmu_kb' => round(($metrics['pmu'] ?? 0) / 1024),
    ];
}

// Build summary scores from main() entry (covers full request).
$main = $flat['main()'] ?? $flat[array_key_first($flat)];
$top_entry = $callgraph[0] ?? ['fn' => 'unknown', 'wt_ms' => 0, 'ct' => 0];

$output = [
    'scores' => [
        'wall_time_ms'          => round(($main['wt'] ?? 0) / 1000),
        'cpu_time_ms'           => round(($main['cpu'] ?? 0) / 1000),
        'memory_peak_mb'        => round(($main['pmu'] ?? 0) / 1024 / 1024, 2),
        'function_calls_total'  => array_sum(array_column(array_values($flat), 'ct')),
        'top_function'          => $top_entry['fn'],
        'top_function_wall_ms'  => $top_entry['wt_ms'],
        'top_function_calls'    => $top_entry['ct'],
    ],
    'callgraph_top_10' => $callgraph,
    'ts' => gmdate('Y-m-d\TH:i:s\Z'),
];

echo json_encode($output, JSON_PRETTY_PRINT) . "\n";
