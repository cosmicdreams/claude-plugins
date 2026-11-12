-- SQL ports of drover/scripts/fingerprint.py helpers. Keep in step with that file.

-- Short-circuit if()/multiIf() re-evaluated shared regex extractions per branch here and
-- cost ~5x CPU. Every function below is safe to evaluate eagerly (OrNull variants only).
SET short_circuit_function_evaluation = 'disable';

-- fingerprint.normalize(): same substitutions, same order. Split in two so callers can
-- apply the request-id step to every row, group, and run the rest once per distinct value.
CREATE FUNCTION drover_normalize_reqid AS (s) -> replaceRegexpAll(s, '\\b[0-9a-f]{8,}-[0-9a-f-]{8,}\\b', 'REQID');

CREATE FUNCTION drover_normalize_rest AS (s) -> lowerUTF8(trimBoth(
  replaceRegexpAll(
    replaceRegexpAll(
      replaceRegexpAll(
        replaceRegexpAll(
          replaceRegexpAll(
            replaceRegexpAll(
              replaceRegexpAll(s,
                '\\[[^\\]]*\\]|\\b\\d{4}[-/]\\d{2}[-/]\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?\\b|\\b\\w{3}, \\d{4}/\\d{2}/\\d{2} - \\d{2}:\\d{2}\\b', 'TS'),
              '\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b', 'IP'),
            '(?i)\\bpid \\d+\\b', 'pid'),
          '0x[0-9a-fA-F]+', 'ADDR'),
        '(?:/[^\\s/]+){3,}/([^\\s/]+/[^\\s/]+)', 'PATH/\\1'),
      '\\b\\d+\\b', 'N'),
    '\\s+', ' ')));

CREATE FUNCTION drover_normalize AS (s) -> drover_normalize_rest(drover_normalize_reqid(s));

-- First 12 hex characters of sha256(key), as fingerprint_structured() returns.
CREATE FUNCTION drover_fp AS (key) -> lower(substring(hex(SHA256(key)), 1, 12));

-- Python str.strip(). Python's \s is Unicode and RE2's is ASCII: ch_aggregate.load_sql()
-- rewrites every \s and \S in these files to Python's 29 whitespace characters.
CREATE FUNCTION drover_strip AS (s) -> replaceRegexpAll(s, '^\\s+|\\s+$', '');

-- parsers.common.normalize_severity()
CREATE FUNCTION drover_severity AS (t) -> transform(lowerUTF8(drover_strip(t)),
  ['emergency','alert','crit','critical','err','error','warn','warning','notice','info','debug',
   'fatal','parse','deprecated','strict','user_error','user_warning','user_notice','user_deprecated'],
  ['critical','critical','critical','critical','error','error','warning','warning','notice','info','info',
   'critical','critical','info','info','error','warning','notice','info'],
  'unknown');

-- 'YYYY-MM-DD' of the daily file a row came from (<date>.<env>.<type>.log[.gz]).
CREATE FUNCTION drover_file_day AS (f) -> toDate(extract(f, '^(\\d{4}-\\d{2}-\\d{2})\\.'));
