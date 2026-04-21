# Shared helpers for drover bats tests.
#
# Libraries are vendored under _libs/ so the test suite is self-contained
# (bats-support/assert/mock are not in homebrew-core). Licenses are MIT.

_HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_libs/bats-support/load.bash
. "$_HELPER_DIR/_libs/bats-support/load.bash"
# shellcheck source=_libs/bats-assert/load.bash
. "$_HELPER_DIR/_libs/bats-assert/load.bash"
# shellcheck source=_libs/bats-mock/stub.bash
. "$_HELPER_DIR/_libs/bats-mock/stub.bash"

# run_timeout <seconds> <command...>
# Portable replacement for GNU `timeout` on macOS. Runs the command,
# kills it after N seconds, returns the command's output via $output
# and exit status via $status when used inside bats `run`.
run_timeout() {
  local secs="$1"; shift
  perl -e '
    use POSIX ":sys_wait_h";
    my $secs = shift @ARGV;
    my $pid = fork();
    if ($pid == 0) { exec @ARGV; exit 127; }
    local $SIG{ALRM} = sub { kill "TERM", $pid; };
    alarm $secs;
    waitpid($pid, 0);
    exit ($? >> 8);
  ' -- "$secs" "$@"
}
