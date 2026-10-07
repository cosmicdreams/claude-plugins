#!/bin/zsh
# End-to-end: run the real sandbox bootstrap against fixture repositories and check the disk, not the
# hook's answer. macOS only. Usage: zsh tests/e2e/run.zsh
set -u
source_plugin=${0:A:h:h:h}
root=/private/tmp/gr-e2e
# Run a copy of the plugin whose policy also lists the fixture folder as a project container, so the
# fixture's main worktrees are found the way the person's real projects are. Same code, one more path.
plugin=/private/tmp/gr-e2e-plugin
/bin/rm -rf $plugin; mkdir -p $plugin; /bin/cp -R $source_plugin/hooks $plugin/
/usr/bin/python3 -I -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["containers"].append("/private/tmp/gr-e2e"); json.dump(d,open(p,"w"),indent=2)' $plugin/hooks/policy.json
runpy=$plugin/hooks/sandbox/run.py
qfile=$HOME/.golden-rule/quarantine.json
pass=0; fail=0
ok() { print -- "pass  $1"; pass=$((pass + 1)) }
no() { print -- "FAIL  $1${2:+ ($2)}"; fail=$((fail + 1)) }

# gr <cwd> <command>: run a command through the bootstrap the way the mod's wrapper does.
gr() {
  local state=$(/usr/bin/mktemp -t gr-e2e)
  (cd "$1" && /usr/bin/python3 -I "$runpy" --command "$(printf %s "$2" | /usr/bin/base64)" --state "$state") >"$root/out" 2>&1
  local s=$?
  GR_PWD=$(/bin/cat "$state" 2>/dev/null); /bin/rm -f "$state"
  return $s
}
argv() { (cd "$1" && /usr/bin/python3 -I "$runpy" --argv "$(printf %s "$2" | /usr/bin/base64)") >"$root/out" 2>&1 }
unchanged() { [ "$(git -C "$1" rev-parse HEAD)" = "$2" ] && [ "$(git -C "$1" branch --show-current)" = main ] && [ -z "$(git -C "$1" status --porcelain)" ] }
forget() { /usr/bin/python3 -I -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); [d.pop(k) for k in list(d) if k.startswith("/private/tmp/gr-e2e")]; json.dump(d,open(p,"w"),indent=2)' "$qfile" 2>/dev/null }

# ---- fixtures ----
/bin/rm -rf "$root"; mkdir -p "$root/p/worktrees" "$root/origin.git"
git init -q --bare -b main "$root/origin.git"
git init -q -b main "$root/p/worktrees/main"
M=$root/p/worktrees/main
git -C $M config user.email e2e@example.com; git -C $M config user.name e2e
mkdir -p $M/src/main; echo ref > $M/README.md; echo k > $M/src/main/K.java
git -C $M add -A; git -C $M commit -q -m "chore: initial"; git -C $M remote add origin "$root/origin.git"; git -C $M push -q origin main
HEAD0=$(git -C $M rev-parse HEAD)
# A linked main worktree: the repository's first checkout is elsewhere, main is added beside it.
git clone -q "$root/origin.git" "$root/l/base"; git -C "$root/l/base" checkout -q -b base
mkdir -p "$root/l/worktrees"; git -C "$root/l/base" worktree add -q ../worktrees/main main
L=$root/l/worktrees/main; LHEAD=$(git -C $L rev-parse HEAD)

# ---- the main worktree's files ----
gr $M 'echo hacked >> README.md'; [ $? -ne 0 ] && unchanged $M $HEAD0 && ok "shell append into main refused" || no "shell append into main"
gr $M "sed -i '' s/ref/x/ README.md"; unchanged $M $HEAD0 && ok "sed -i in main refused" || no "sed -i in main"
gr $root "python3 -c \"open('$M/new.txt','w').write('x')\""; [ ! -e $M/new.txt ] && ok "python write into main refused" || no "python write into main"
gr $root/p/worktrees "cat > main/heredoc.txt <<'X'
x
X"; [ ! -e $M/heredoc.txt ] && ok "heredoc into main refused" || no "heredoc into main"

# ---- the main worktree's git state ----
gr $M 'git checkout -q -b sneaky'; unchanged $M $HEAD0 && ok "checkout -b in main refused" || no "checkout -b in main"
gr $M 'git reset -q --hard HEAD~0 && echo x > f && git add f'; unchanged $M $HEAD0 && ok "reset and add in main refused" || no "reset/add in main"
gr $M 'git merge -q --ff-only origin/main'; unchanged $M $HEAD0 && ok "local merge in main refused" || no "local merge in main"
gr $M 'git config core.fsmonitor evil'; [ -z "$(git -C $M config core.fsmonitor)" ] && ok "config write in main refused" || no "config write in main"
gr $M 'echo x > .git/hooks/post-checkout'; [ ! -e $M/.git/hooks/post-checkout ] && ok "planting a hook refused" || no "planting a hook"
gr $M 'git branch -m main renamed'; unchanged $M $HEAD0 && ok "renaming the main branch refused" || no "renaming the main branch"
gr $M 'mv .git/refs .git/objects/saved-refs'; [ -d $M/.git/refs/heads ] && ok "renaming main's refs folder refused" || no "renaming refs folder"

# ---- the reference cannot be moved ----
gr $root/p 'mv worktrees/main worktrees/old'; [ -d $M/.git ] && ok "moving worktrees/main refused" || no "moving worktrees/main"
gr $root/p 'mv worktrees wt'; [ -d $M/.git ] && ok "moving worktrees/ refused" || no "moving worktrees/"
gr $root 'mv p p2'; [ -d $M/.git ] && ok "moving the project folder refused" || no "moving the project folder"

# ---- the happy path ----
gr $M 'git fetch -q origin'; [ $? -eq 0 ] && ok "fetch from main allowed" || no "fetch from main" "$(tail -2 $root/out)"
gr $M 'git worktree add -q ../feat -b feature/t --no-track origin/main'; [ -d $root/p/worktrees/feat ] && ok "worktree add --no-track from main allowed" || no "worktree add" "$(tail -2 $root/out)"
F=$root/p/worktrees/feat
gr $F 'echo y > y.txt && echo j > src/main/J.java && git add -A && git -c user.email=e@e -c user.name=e commit -q -m "feat: y" && git push -q origin HEAD:feature/t'
[ $? -eq 0 ] && [ -n "$(git -C $root/origin.git rev-parse --verify -q feature/t)" ] && ok "commit and push in the feature worktree allowed (src/main too)" || no "feature commit/push" "$(tail -2 $root/out)"
gr $F 'git worktree add -q ../tmp2 -b feature/tmp2 --no-track origin/main && git worktree remove ../tmp2 && git branch -q -D feature/tmp2'
[ $? -eq 0 ] && ok "creating and deleting a feature branch allowed (packed-refs while main is loose)" || no "branch delete" "$(tail -2 $root/out)"
unchanged $M $HEAD0 && ok "main untouched by the happy path" || no "main changed by the happy path"

# ---- what stays allowed around a project ----
gr $root/p 'echo notes > plans.md'; [ -e $root/p/plans.md ] && ok "writing in the project root (outside main) allowed" || no "project root write" "$(tail -2 $root/out)"
gr $root 'mkdir -p new/worktrees && git init -q -b main new/worktrees/main'; [ -d $root/new/worktrees/main/.git ] && ok "creating a new project's main worktree allowed" || no "new project main" "$(tail -2 $root/out)"
start=$(/usr/bin/python3 -c 'import time; print(time.time())')
for i in 1 2 3 4 5; do gr $F 'true'; done
per=$(/usr/bin/python3 -c "import time; print(round((time.time()-$start)/5, 3))")
/usr/bin/python3 -c "import sys; sys.exit(0 if $per < 0.5 else 1)" && ok "a command costs ${per}s through the sandbox" || no "per-command cost ${per}s"

# ---- pushes to main ----
gr $F 'git push origin HEAD:main'; s=$?; [ $s -eq 126 ] && [ "$(git -C $root/origin.git rev-parse main)" = "$HEAD0" ] && grep -q "pull request" $root/out && ok "push to main from a governed repository refused" || no "governed push to main" "$(tail -2 $root/out)"
gr $root "git -C $F push origin +HEAD:refs/heads/main"; [ $? -eq 126 ] && ok "push to main via git -C and a full refspec refused" || no "git -C push to main"
git init -q --bare -b main $root/free.git; git init -q -b main $root/free; git -C $root/free commit -q --allow-empty -m "chore: free"; git -C $root/free remote add origin $root/free.git
gr $root/free 'git push -q origin main'; [ $? -eq 0 ] && ok "push to main in an ungoverned repository allowed (decision 5)" || no "ungoverned push" "$(tail -2 $root/out)"
gr $F 'gh pr merge 1 --admin --squash'; [ $? -eq 126 ] && ok "gh pr merge --admin refused in a governed repository" || no "gh --admin"

# ---- shell semantics ----
gr $root/p 'cd worktrees/feat'; [ "$GR_PWD" = "$F" ] && ok "cd is carried back to the shell" || no "cd carried back" "$GR_PWD"
gr $root 'exit 7'; [ $? -eq 7 ] && ok "exit status passes through" || no "exit status"
gr $root/p "cd $F; exit 0"; [ "$GR_PWD" = "$F" ] && ok "cd is carried back even when the command exits" || no "cd before exit" "$GR_PWD"
( gr $M "echo '~nobody-gr-e2e/x'" ) & pid=$!; ( sleep 10; kill $pid 2>/dev/null ) & killer=$!
wait $pid; s=$?; kill $killer 2>/dev/null; [ $s -eq 0 ] && ok "a ~user token does not hang the bootstrap" || no "~user token" "exit $s"

# ---- linked main worktree ----
gr $L 'echo x > f && git add f && git -c user.email=e@e -c user.name=e commit -q -m "chore: x"'
[ "$(git -C $L rev-parse HEAD)" = "$LHEAD" ] && [ -z "$(git -C $L status --porcelain)" ] && ok "linked main worktree refused" || no "linked main worktree"
gr $root/l/base 'git checkout -q -b other'; [ $? -eq 0 ] && ok "the linked repository's own first checkout is not main and stays writable" || no "linked base checkout" "$(tail -2 $root/out)"
gr $root/l/base 'git config core.fsmonitor evil'; [ -z "$(git -C $root/l/base config core.fsmonitor)" ] && ok "a linked main worktree's shared config refused" || no "linked shared config"
gr $root "echo x > $root/l/base/.git/worktrees/main/HEAD"; [ "$(git -C $L rev-parse HEAD)" = "$LHEAD" ] && ok "a linked main worktree's own HEAD refused from anywhere" || no "linked HEAD"

# ---- another plugin's process ----
argv $root '["/bin/sh","-c","echo x > '$M'/plugin.txt"]'; [ ! -e $M/plugin.txt ] && ok "another plugin's process cannot write into main" || no "plugin process write"

# ---- the guard's own files ----
gr $root "touch '$plugin/hooks/e2e-probe'"; [ ! -e "$plugin/hooks/e2e-probe" ] && ok "the plugin's own files refused" || { no "plugin files"; /bin/rm -f "$plugin/hooks/e2e-probe"; }
gr $root 'mkdir -p ~/.claude/skills/gr-e2e-probe/hooks'; [ ! -e ~/.claude/skills/gr-e2e-probe/hooks ] && ok "a new hooks module in a skills folder refused" || { no "skills hooks"; /bin/rm -rf ~/.claude/skills/gr-e2e-probe; }
/bin/rmdir ~/.claude/skills/gr-e2e-probe 2>/dev/null
gr $root 'mv ~/.claude/hooks ~/.claude/hooks-gr-e2e'; if [ -d ~/.claude/hooks-gr-e2e ]; then /bin/mv ~/.claude/hooks-gr-e2e ~/.claude/hooks; no "moving a guard folder"; else ok "moving a folder that holds the guard refused"; fi

# ---- tripwire: a writer the sandbox cannot see ----
( sleep 0.5; echo outside > $M/from-outside.txt ) &
gr $M 'command -v docker >/dev/null; sleep 1.5; echo looked'; s=$?
grep -q "a change was observed in the main worktree" $root/out && [ $s -ne 0 ] && ok "tripwire reports a write made outside the sandbox" || no "tripwire report" "$(tail -2 $root/out)"
gr $M 'ls'; [ $? -eq 126 ] && grep -q quarantined $root/out && ok "a quarantined main worktree refuses further commands" || no "quarantine holds"
gr $F 'ls'; [ $? -eq 0 ] && ok "other worktrees keep working during a quarantine" || no "feature during quarantine"
forget; /bin/rm -f $M/from-outside.txt
( sleep 0.3; echo outside2 > $M/unwatched.txt ) &
gr $M 'sleep 1; ls >/dev/null'; s=$?; wait; /bin/rm -f $M/unwatched.txt
[ $s -eq 0 ] && ! grep -q "change was observed" $root/out && ok "a plain read in main is not scanned (only out-of-sandbox commands are)" || no "plain read scanned"
gr $M 'ls >/dev/null'; [ $? -eq 0 ] && ok "a read-only command in main is fine and trips nothing" || no "read-only in main" "$(tail -2 $root/out)"
forget
# A corrupt quarantine record refuses commands in main worktrees instead of clearing every quarantine.
mkdir -p $HOME/.golden-rule; [ -f $qfile ] && /bin/cp -p $qfile $root/quarantine.backup
echo '{not json' > $qfile
gr $M 'ls >/dev/null'; s=$?
if [ -f $root/quarantine.backup ]; then /bin/cp -p $root/quarantine.backup $qfile; else /bin/rm -f $qfile; fi
[ $s -eq 126 ] && ok "an unreadable quarantine record refuses rather than clears" || no "corrupt quarantine" "exit $s"

# ---- hard links ----
gr $root "ln $M/README.md $root/hard"; [ ! -e $root/hard ] && ok "a hard link to a file in main refused" || no "hard link into main created"

print -- "\n$pass passed, $fail failed"
[ $fail -eq 0 ]
