-- Summarise one month of Acquia apache-access logs for drover trend reports.
-- Input: __GLOB__, replaced by trends.py with a quoted single-directory brace
-- glob of the month's files, and {top:UInt32}, how many routes to keep. Each SELECT emits JSON rows
-- tagged with `section`; scripts/trends.py assembles them into a rollup.
-- The day is the file's day (YYYY-MM-DD prefix), matching drover's coverage
-- ledger, so lines that spill past UTC midnight count on their file's day.

CREATE VIEW req AS
SELECT
  substring(_file, 1, 10) AS day,
  toUInt16OrZero(extract(line, '" (\\d{3}) ')) AS status,
  extract(line, '"([A-Z]+) [^ ]+ HTTP') AS method,
  cutQueryString(extract(line, '"[A-Z]+ ([^ ]+) HTTP')) AS path,
  toUInt64OrZero(extract(line, '" \\d{3} (\\d+)')) AS bytes,
  toUInt64OrZero(extract(line, 'request_time=(\\d+)')) / 1000 AS ms,
  lower(extract(line, ' host=([^ ]+)')) AS host,
  extract(line, '"[^"]*" "([^"]*)" vhost=') AS ua,
  if(extract(line, 'forwarded_for="([^",]+)') NOT IN ('', '-'),
     extract(line, 'forwarded_for="([^",]+)'),
     extract(line, '^(\\S+)')) AS ip
FROM file(__GLOB__, 'LineAsString', 'line String')
WHERE line != '';

CREATE VIEW classified AS
SELECT *,
  multiIf(
    match(ua, '(?i)GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Bytespider|meta-externalagent|meta-externalfetcher|Amazonbot|CCBot|Google-Extended|Applebot-Extended|cohere-ai|Diffbot|DuckAssistBot|MistralAI-User'), 'ai',
    match(ua, '(?i)Googlebot|bingbot|YandexBot|DuckDuckBot|Baiduspider|Applebot|Slurp|SeznamBot|Qwantbot|PetalBot'), 'search',
    match(ua, '(?i)bot|crawl|spider|slurp|scrapy|curl|wget|python-requests|python-urllib|go-http|okhttp|java/|libwww|httpclient|headless|axios|node-fetch|facebookexternalhit|Pingdom') OR ua IN ('', '-'), 'other-bot',
    'human') AS agent_class,
  multiIf(
    agent_class = 'human', 'browsers',
    ua IN ('', '-'), '(no user agent)',
    extract(ua, '(?i)(GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Bytespider|meta-externalagent|meta-externalfetcher|Amazonbot|CCBot|Google-Extended|Applebot-Extended|cohere-ai|Diffbot|DuckAssistBot|MistralAI-User|Googlebot|bingbot|YandexBot|DuckDuckBot|Baiduspider|Applebot|SeznamBot|Qwantbot|PetalBot|AhrefsBot|SemrushBot|MJ12bot|DotBot|DataForSeoBot|BLEXBot|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|UptimeRobot|Pingdom|curl|Wget|python-requests|python-urllib|Go-http-client|okhttp|axios|HeadlessChrome|Scrapy)') != '',
      extract(ua, '(?i)(GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Bytespider|meta-externalagent|meta-externalfetcher|Amazonbot|CCBot|Google-Extended|Applebot-Extended|cohere-ai|Diffbot|DuckAssistBot|MistralAI-User|Googlebot|bingbot|YandexBot|DuckDuckBot|Baiduspider|Applebot|SeznamBot|Qwantbot|PetalBot|AhrefsBot|SemrushBot|MJ12bot|DotBot|DataForSeoBot|BLEXBot|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|UptimeRobot|Pingdom|curl|Wget|python-requests|python-urllib|Go-http-client|okhttp|axios|HeadlessChrome|Scrapy)'),
    'other') AS agent_name,
  multiIf(
    match(path, '(?i)^/_fragment'), 'symfony-fragment',
    match(path, '(?i)wp-(login|admin|content|includes|json)|xmlrpc\\.php'), 'wordpress',
    match(path, '(?i)/\\.(env|git|aws|ssh|svn|htpasswd)'), 'secrets',
    match(path, '(?i)phpmyadmin|adminer|/cgi-bin/|/vendor/phpunit|/actuator|/solr/admin'), 'admin-tools',
    '') AS probe,
  replaceRegexpAll(replaceRegexpAll(path, '/\\d+(/|$)', '/{n}\\1'), '/\\d+(/|$)', '/{n}\\1') AS route
FROM req;

SELECT 'totals' AS section,
  count() AS requests, sum(bytes) AS bytes, uniqExact(ip) AS unique_ips,
  round(sum(ms)) AS time_ms,
  round(quantileTDigest(0.5)(ms)) AS p50_ms, round(quantileTDigest(0.95)(ms)) AS p95_ms,
  countIf(status BETWEEN 200 AND 299) AS s2xx, countIf(status BETWEEN 300 AND 399) AS s3xx,
  countIf(status BETWEEN 400 AND 499) AS s4xx, countIf(status >= 500) AS s5xx,
  countIf(status = 404) AS s404, countIf(status = 0) AS unparsed
FROM classified
FORMAT JSONEachRow;

SELECT 'day' AS section, day,
  count() AS requests, sum(bytes) AS bytes, uniqExact(ip) AS unique_ips,
  round(quantileTDigest(0.5)(ms)) AS p50_ms, round(quantileTDigest(0.95)(ms)) AS p95_ms,
  countIf(status BETWEEN 400 AND 499) AS s4xx, countIf(status >= 500) AS s5xx,
  countIf(agent_class = 'human') AS human, countIf(agent_class = 'search') AS search,
  countIf(agent_class = 'ai') AS ai, countIf(agent_class = 'other-bot') AS other_bot
FROM classified
GROUP BY day ORDER BY day
FORMAT JSONEachRow;

SELECT 'agent' AS section, agent_class, agent_name,
  count() AS requests, round(sum(ms)) AS time_ms, sum(bytes) AS bytes
FROM classified
GROUP BY agent_class, agent_name ORDER BY requests DESC, agent_name
LIMIT 60
FORMAT JSONEachRow;

SELECT 'host' AS section, host, count() AS requests
FROM classified
GROUP BY host ORDER BY requests DESC, host
LIMIT 20
FORMAT JSONEachRow;

SELECT 'probe' AS section, probe,
  count() AS requests, countIf(status = 200) AS answered_200, uniqExact(ip) AS unique_ips
FROM classified
WHERE probe != ''
GROUP BY probe ORDER BY requests DESC
FORMAT JSONEachRow;

SELECT 'route' AS section, route,
  count() AS requests, round(sum(ms)) AS time_ms, round(quantileTDigest(0.95)(ms)) AS p95_ms,
  countIf(status >= 500) AS s5xx, countIf(status = 404) AS s404,
  countIf(agent_class != 'human') AS non_human
FROM classified
WHERE probe = ''
GROUP BY route
ORDER BY requests DESC, route
LIMIT {top:UInt32}
FORMAT JSONEachRow;

SELECT 'route' AS section, route,
  count() AS requests, round(sum(ms)) AS time_ms, round(quantileTDigest(0.95)(ms)) AS p95_ms,
  countIf(status >= 500) AS s5xx, countIf(status = 404) AS s404,
  countIf(agent_class != 'human') AS non_human
FROM classified
WHERE probe = ''
GROUP BY route
ORDER BY time_ms DESC, route
LIMIT {top:UInt32}
FORMAT JSONEachRow;
