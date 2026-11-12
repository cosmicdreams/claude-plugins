-- Share of each site's traffic from AI and search crawlers.
SELECT extract(_path, '/Sites/([^/]+)/') AS project,
       count() AS requests,
       round(100 * countIf(match(ua, '(?i)GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|anthropic|PerplexityBot|Bytespider|meta-externalagent|Amazonbot|CCBot|Google-Extended|Applebot-Extended')) / count(), 2) AS pct_ai,
       round(100 * countIf(match(ua, '(?i)Googlebot|bingbot|YandexBot|DuckDuckBot|Baiduspider')) / count(), 2) AS pct_search,
       round(100 * countIf(match(ua, '(?i)bot|crawl|spider|slurp|curl|python-requests|wget|go-http|GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|anthropic|PerplexityBot|Bytespider|meta-externalagent|Amazonbot|CCBot|Google-Extended|Applebot-Extended')) / count(), 2) AS pct_any_bot
FROM (
  SELECT _path, extract(line, '"[^"]*" "([^"]*)"\\s+vhost=') AS ua
  FROM file({root:String} || '/*/20*/*/*.prod.apache-access.log.gz', 'LineAsString', 'line String')
)
GROUP BY project
ORDER BY requests DESC
FORMAT JSONEachRow
