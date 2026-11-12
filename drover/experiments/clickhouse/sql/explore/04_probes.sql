-- Vulnerability probing: requests for paths a Drupal site never serves.
SELECT extract(_path, '/Sites/([^/]+)/') AS project,
       multiIf(match(path, '(?i)^/_fragment'), '/_fragment (Symfony RCE probe)',
               match(path, '(?i)wp-(login|admin|content|includes)|xmlrpc\\.php'), 'WordPress paths',
               match(path, '(?i)/\\.(env|git|aws|ssh)'), 'Secrets (.env, .git)',
               match(path, '(?i)phpmyadmin|adminer|/cgi-bin/'), 'Admin tools',
               'other') AS probe,
       count() AS requests,
       uniqExactIf(ff, ff NOT IN ('', '-')) AS client_ips,
       round(100 * countIf(status = 200) / count(), 2) AS pct_200
FROM (
  SELECT _path, line, extract(line, '"[A-Z]+ ([^ ]+) HTTP') AS path,
         extract(line, 'forwarded_for="([^",]+)') AS ff,
         toUInt16OrZero(extract(line, '" (\\d{3}) ')) AS status
  FROM file({root:String} || '/*/20*/*/*.prod.apache-access.log.gz', 'LineAsString', 'line String')
  WHERE match(path, '(?i)^/_fragment|wp-(login|admin|content|includes)|xmlrpc\\.php|/\\.(env|git|aws|ssh)|phpmyadmin|adminer|/cgi-bin/')
)
GROUP BY project, probe
ORDER BY requests DESC
FORMAT JSONEachRow
