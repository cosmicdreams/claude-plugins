# Shared helpers for drover bats tests.

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
