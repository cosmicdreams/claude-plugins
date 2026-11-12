-- Every captured log line, every project and type: the whole corpus in one scan.
SELECT project, log_type,
       count() AS files,
       sum(file_lines) AS lines,
       sum(file_bytes) AS bytes,
       sum(gz_bytes) AS gz_bytes
FROM (
  SELECT extract(_path, '/Sites/([^/]+)/') AS project,
         extract(_file, '\\.prod\\.(.+)\\.log') AS log_type,
         _file, count() AS file_lines,
         sum(length(line) + 1) AS file_bytes,   -- decompressed text
         any(_size) AS gz_bytes                 -- bytes on disk
  FROM file({root:String} || '/*/20*/*/*.prod.*.log.gz', 'LineAsString', 'line String')
  GROUP BY project, log_type, _file
)
GROUP BY project, log_type
ORDER BY project, log_type
FORMAT JSONEachRow
