-- What fills each site's watchdog log: share of entries by channel, top three per site.
-- Counts entries (header lines); a multi-line entry's continuation lines count once, with it.
SELECT project, channel, entries, round(100 * entries / sum(entries) OVER (PARTITION BY project), 1) AS pct
FROM (
  SELECT extract(_path, '/Sites/([^/]+)/') AS project,
         if(splitByChar('|', line)[3] = '', '(none)', splitByChar('|', line)[3]) AS channel,
         count() AS entries
  FROM file({root:String} || '/*/20*/*/*.prod.drupal-watchdog.log.gz', 'LineAsString', 'line String')
  WHERE match(line, '^\\w{3}\\s+\\d+\\s+\\d{2}:\\d{2}:\\d{2}\\s+\\S+\\s+[^:]+:')  -- same header test as watchdog.sql
  GROUP BY project, channel
)
ORDER BY project, entries DESC
LIMIT 3 BY project
FORMAT JSONEachRow
