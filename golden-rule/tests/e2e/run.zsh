#!/bin/zsh
# End-to-end: run the real bootstrap against fixture repositories and check the disk, not the hook's
# answer. macOS only. Usage: zsh tests/e2e/run.zsh
set -u
source_plugin=${0:A:h:h:h}
root=/private/tmp/gr-e2e
# Run a copy of the plugin whose policy also lists the fixture folder as a project container, so the
# fixture's main worktrees are found the way the person's real projects are. Same code, one more path.
plugin=/private/tmp/gr-e2e-plugin
/bin/rm -rf $plugin; mkdir -p $plugin; /bin/cp -R $source_plugin/hooks $plugin/
/usr/bin/python3 -I -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["containers"] += ["/private/tmp/gr-e2e", "/private/tmp/gr-e2e/*"]; json.dump(d,open(p,"w"),indent=2)' $plugin/hooks/policy.json
runpy=$plugin/hooks/sandbox/run.py
pass=0; fail=0
ok() { print -- "pass  $1"; pass=$((pass + 1)) }
no() { print -- "FAIL  $1${2:+ ($2)}"; fail=$((fail + 1)) }

# gr <cwd> <command>: run a command through the bootstrap the way the mod's wrapper does.
gr() {
  local state=$(/usr/bin/mktemp -t gr-e2e)
  (cd "$1" && printf '%s\n' "$2" | /usr/bin/python3 -I -B -X pycache_prefix=/var/empty/golden-rule "$runpy" --stdin --state "$state") >"$root/out" 2>&1
  local s=$?
  GR_PWD=$(/bin/cat "$state" 2>/dev/null); /bin/rm -f "$state"
  return $s
}
argv() { (cd "$1" && /usr/bin/python3 -I -B -X pycache_prefix=/var/empty/golden-rule "$runpy" --argv "$(printf %s "$2" | /usr/bin/base64)") >"$root/out" 2>&1 }
unchanged() { [ "$(git -C "$1" rev-parse HEAD)" = "$2" ] && [ "$(git -C "$1" branch --show-current)" = main ] && [ -z "$(git -C "$1" status --porcelain)" ] }

# ---- fixtures ----
/bin/rm -rf "$root"; mkdir -p "$root/p/worktrees" "$root/origin.git"
git init -q --bare -b main "$root/origin.git"
git init -q -b main "$root/p/worktrees/main"
M=$root/p/worktrees/main
git -C $M config user.email e2e@example.com; git -C $M config user.name e2e
mkdir -p $M/src/main; echo ref > $M/README.md; echo k > $M/src/main/K.java
git -C $M add -A; git -C $M commit -q -m "chore: initial"; git -C $M remote add origin "$root/origin.git"; git -C $M push -q origin main
git -C $M fetch -q origin; git -C $M branch -q --set-upstream-to=origin/main
HEAD0=$(git -C $M rev-parse HEAD)
# A linked main worktree: the repository's first checkout is elsewhere, main is added beside it.
git clone -q "$root/origin.git" "$root/l/base"; git -C "$root/l/base" checkout -q -b base
mkdir -p "$root/l/worktrees"; git -C "$root/l/base" worktree add -q ../worktrees/main main
L=$root/l/worktrees/main; LHEAD=$(git -C $L rev-parse HEAD)
rename=(-m main renamed)

# ---- committable changes in main are put back ----
gr $M 'echo hacked >> README.md'; s=$?; unchanged $M $HEAD0 && [ $s -ne 0 ] && grep -q "reverted committable changes" $root/out && ok "a shell append to a tracked file in main is reverted and reported" || no "append reverted" "$(tail -3 $root/out)"
gr $M "sed -i '' s/ref/x/ README.md"; unchanged $M $HEAD0 && ok "sed -i in main is reverted" || no "sed -i reverted"
gr $root "python3 -c \"open('$M/new.txt','w').write('x')\""; [ ! -e $M/new.txt ] && ok "a new unignored file written into main from outside it is deleted" || no "named new file"
gr $root/p/worktrees "cat > main/heredoc.txt <<'X'
x
X"; [ ! -e $M/heredoc.txt ] && ok "a heredoc into main is deleted" || no "heredoc into main"
gr $M 'rm README.md'; unchanged $M $HEAD0 && ok "a deleted tracked file is restored" || no "deletion restored"
gr $M 'echo x > f && git add f'; unchanged $M $HEAD0 && ok "a staged new file is unstaged and removed" || no "git add reverted" "$(git -C $M status --porcelain)"
argv $root '["/bin/sh","-c","echo x >> '$M'/README.md"]'; unchanged $M $HEAD0 && ok "another plugin's process change in main is reverted" || no "plugin process revert"
echo mine >> $M/README.md
gr $M 'echo more >> README.md'; [ "$(tail -1 $M/README.md)" = more ] && grep -q "left as they were" $root/out && ok "a file already changed before the command is left alone and reported" || no "pre-existing change" "$(tail -3 $root/out)"
git -C $M checkout -q -- README.md

# ---- main's HEAD and branch ----
gr $M 'git checkout -q -b sneaky'; [ $? -eq 126 ] && unchanged $M $HEAD0 && ok "checkout -b in main refused" || no "checkout -b in main"
gr $M 'git commit -q --allow-empty -m x'; [ $? -eq 126 ] && unchanged $M $HEAD0 && ok "commit in main refused" || no "commit in main"
gr $root "git -C $M reset -q --hard HEAD~1"; [ $? -eq 126 ] && ok "reset to another commit via git -C refused" || no "reset via -C"
gr $M "git branch ${rename[*]}"; [ $? -eq 126 ] && unchanged $M $HEAD0 && ok "renaming the main branch refused" || no "renaming the main branch"
gr $M 'git pull'; [ $? -eq 126 ] && ok "pull without --ff-only refused" || no "plain pull"
gr $M 'git pull -q --ff-only origin main'; [ $? -eq 0 ] && ok "pull --ff-only in main allowed (keeping the reference current)" || no "ff-only pull" "$(tail -2 $root/out)"
git clone -q $root/origin.git $root/pusher; git -C $root/pusher -c user.email=e@e -c user.name=e commit -q --allow-empty -m "chore: upstream"; git -C $root/pusher push -q origin main
gr $M 'git pull -q --ff-only origin main'; [ $? -eq 0 ] && ! grep -q "HEAD moved" $root/out && ok "a fast-forward to published commits is not reported as HEAD moved" || no "ff reported" "$(tail -2 $root/out)"
HEAD0=$(git -C $M rev-parse HEAD)
git -C $root/pusher checkout -q -b feature/x; git -C $root/pusher -c user.email=e@e -c user.name=e commit -q --allow-empty -m "feat: unreviewed"; git -C $root/pusher push -q origin feature/x; git -C $M fetch -q origin
gr $M 'git merge -q --ff-only origin/feature/x'; [ $? -eq 126 ] && unchanged $M $HEAD0 && ok "fast-forwarding main to a pushed feature branch is refused" || no "ff to feature branch"
gr $M 'git pull -q --ff-only origin feature/x'; [ $? -eq 126 ] && unchanged $M $HEAD0 && ok "pulling a feature branch into main is refused" || no "pull feature into main"
gr $M 'git update-ref refs/remotes/origin/main origin/feature/x'; [ $? -eq 126 ] && ok "forging main's upstream with update-ref is refused" || no "update-ref upstream"
gr $M 'git fetch -q origin +feature/x:refs/remotes/origin/main'; [ $? -eq 126 ] && ok "forging main's upstream with a fetch refspec is refused" || no "fetch refspec upstream"
gr $M 'git fetch -q origin feature/x && git merge -q --ff-only FETCH_HEAD'; unchanged $M $HEAD0 && grep -q "put back" $root/out && ok "a fast-forward to a feature branch through FETCH_HEAD is undone" || no "FETCH_HEAD ff" "$(tail -2 $root/out)"
gr $M "git remote add evil $root/origin.git && git fetch -q evil && git -c advice.detachedHead=false merge -q --ff-only refs/remotes/evil/feature/x"; unchanged $M $HEAD0 && ok "a fast-forward through another remote is refused or undone" || no "other remote ff" "$(tail -2 $root/out)"
git -C $M remote remove evil 2>/dev/null
git -C $root/pusher checkout -q main; git -C $root/pusher -c user.email=e@e -c user.name=e commit -q --allow-empty -m "feat: unpublished"
gr $M "git remote set-url origin $root/pusher/.git && git pull -q --ff-only origin main"; s=$?; git -C $M remote set-url origin $root/origin.git
unchanged $M $HEAD0 && grep -q "put back" $root/out && ok "a pull after rewriting origin's URL is undone" || no "origin url rewrite" "$(tail -2 $root/out)"
echo hacked >> $M/README.md
gr $M 'git checkout -- README.md && git reset -q --hard'; [ $? -eq 0 ] && unchanged $M $HEAD0 && ok "restoring files and reset --hard to HEAD in main allowed" || no "cleanup in main" "$(tail -2 $root/out)"
gr $M 'git status -s && git log -1 --oneline >/dev/null && git diff --stat'; [ $? -eq 0 ] && ok "read-only git in main allowed" || no "read-only git"

# ---- main as a dev instance ----
printf '/vendor/\n/node_modules/\n*.log\n/.ddev/config.local.yaml\n/web/sites/*/files/\n' > $M/.gitignore
git -C $M add .gitignore; git -C $M commit -q -m "chore: ignores"; HEAD0=$(git -C $M rev-parse HEAD); git -C $M push -q origin main
gr $M 'mkdir -p vendor/a/b node_modules/x .ddev web/sites/default/files/css && for i in {1..3000}; do echo $i > vendor/a/b/f$i.php; done && echo y > .ddev/config.local.yaml && echo z > debug.log && echo c > web/sites/default/files/css/x.css && echo n > node_modules/x/i.js'
[ $? -eq 0 ] && [ -f $M/vendor/a/b/f3000.php ] && [ -f $M/web/sites/default/files/css/x.css ] && unchanged $M $HEAD0 && ok "gitignored files of any size and depth are written freely in main" || no "dev instance writes" "$(tail -3 $root/out)"
gr $M 'echo y > debug.log; touch .'; [ $? -eq 0 ] && ok "touching main's own folder and ignored files is not refused" || no "touch main" "$(tail -2 $root/out)"
mkdir -p $HOME/.gr-e2e-dot; gr $M "echo x > $HOME/.gr-e2e-dot/f"; [ -f $HOME/.gr-e2e-dot/f ] && ok "dot folders outside a main worktree are free" || no "dot folder write"; /bin/rm -rf $HOME/.gr-e2e-dot
gr $root/p 'mv worktrees/main worktrees/old'; [ -d $M/.git ] && ok "moving a main worktree folder refused" || no "moving worktrees/main"
gr $root/p 'mv worktrees wt && mv wt worktrees'; [ $? -eq 0 ] && ok "folders above a main worktree are not governed" || no "moving worktrees/" "$(tail -2 $root/out)"

# ---- the happy path ----
gr $M 'git fetch -q origin'; [ $? -eq 0 ] && ok "fetch from main allowed" || no "fetch from main" "$(tail -2 $root/out)"
gr $M 'git worktree add -q ../feat -b feature/t --no-track origin/main'; [ -d $root/p/worktrees/feat ] && ok "worktree add --no-track from main allowed" || no "worktree add" "$(tail -2 $root/out)"
F=$root/p/worktrees/feat
gr $F 'echo y > y.txt && echo j > src/main/J.java && git add -A && git -c user.email=e@e -c user.name=e commit -q -m "feat: y" && git push -q origin HEAD:feature/t'
[ $? -eq 0 ] && [ -n "$(git -C $root/origin.git rev-parse --verify -q feature/t)" ] && ok "commit and push in the feature worktree allowed (src/main too)" || no "feature commit/push" "$(tail -2 $root/out)"
gr $F 'git worktree add -q ../tmp2 -b feature/tmp2 --no-track origin/main && git worktree remove ../tmp2 && git branch -q -D feature/tmp2'
[ $? -eq 0 ] && ok "creating and deleting a feature branch allowed" || no "branch delete" "$(tail -2 $root/out)"
gr $M 'git worktree add -q ../tmp3 -b feature/tmp3 --no-track origin/main 2>&1 && git worktree remove ../tmp3 2>&1 | tail -1 && git branch -q -D feature/tmp3 > /dev/null'
[ $? -eq 0 ] && [ ! -e $root/p/worktrees/tmp3 ] && ok "redirections are not read as paths (worktree remove 2>&1 from main allowed)" || no "redirection as path" "$(tail -2 $root/out)"
gr $M 'git commit -q --allow-empty -m x > /dev/null 2>&1'; [ $? -eq 126 ] && ok "a redirected commit in main is still refused" || no "redirected commit"
argv $M '["git","push","origin",">","HEAD:main"]'; [ $? -eq 126 ] && ok "another plugin's argument '>' is not read as a redirection (push to main refused)" || no "argv redirection differential"
argv $M '["git","-c","x.y=a b","commit","-q","--allow-empty","-m","x"]'; [ $? -eq 126 ] && unchanged $M $HEAD0 && ok "another plugin's argument with a space stays one word (commit in main refused)" || no "argv space differential"
unchanged $M $HEAD0 && ok "main untouched by the happy path" || no "main changed by the happy path"

# ---- what stays allowed around a project ----
gr $root/p 'echo notes > plans.md'; [ -e $root/p/plans.md ] && ok "writing in the project root (outside main) allowed" || no "project root write" "$(tail -2 $root/out)"
gr $root 'mkdir -p new/worktrees && git init -q -b main new/worktrees/main'; [ -d $root/new/worktrees/main/.git ] && ok "creating a new project's main worktree allowed" || no "new project main" "$(tail -2 $root/out)"
start=$(/usr/bin/python3 -c 'import time; print(time.time())')
for i in 1 2 3 4 5; do gr $F 'true'; done
per=$(/usr/bin/python3 -c "import time; print(round((time.time()-$start)/5, 3))")
/usr/bin/python3 -c "import sys; sys.exit(0 if $per < 0.5 else 1)" && ok "a command costs ${per}s through the bootstrap" || no "per-command cost ${per}s"
start=$(/usr/bin/python3 -c 'import time; print(time.time())')
for i in 1 2 3 4 5; do gr $M 'true'; done
per=$(/usr/bin/python3 -c "import time; print(round((time.time()-$start)/5, 3))")
/usr/bin/python3 -c "import sys; sys.exit(0 if $per < 0.8 else 1)" && ok "a command in main costs ${per}s with the status check" || no "per-command cost in main ${per}s"

# ---- pushes to main ----
gr $F 'git push origin HEAD:main'; s=$?; [ $s -eq 126 ] && [ "$(git -C $root/origin.git rev-parse main)" = "$HEAD0" ] && grep -q "pull request" $root/out && ok "push to main from a governed repository refused" || no "governed push to main" "$(tail -2 $root/out)"
gr $root "git -C $F push origin +HEAD:refs/heads/main"; [ $? -eq 126 ] && ok "push to main via git -C and a full refspec refused" || no "git -C push to main"
git init -q --bare -b main $root/free.git; git init -q -b main $root/free; git -C $root/free commit -q --allow-empty -m "chore: free"; git -C $root/free remote add origin $root/free.git
gr $root/free 'git push -q origin main'; [ $? -eq 0 ] && ok "push to main in an ungoverned repository allowed" || no "ungoverned push" "$(tail -2 $root/out)"
gr $F 'gh pr merge 1 --admin --squash'; [ $? -eq 126 ] && ok "gh pr merge --admin refused in a governed repository" || no "gh --admin"
gr $F "cd $root/free && git push -q origin main"; [ $? -eq 0 ] && ok "a push after cd into an ungoverned repository is judged there (allowed)" || no "cd then ungoverned push" "$(tail -2 $root/out)"
gr $root/free "git status -s >/dev/null; git -C '$F' push origin HEAD:main"; [ $? -eq 126 ] && ok "a later governed push is judged in its own repository (refused)" || no "per-segment governed push"
gr $root "git -C $root/free -C $F push origin HEAD:main"; [ $? -eq 126 ] && ok "every git -C applies in order (refused in the governed one)" || no "-C ordering"
gr $root "git -C $F -C $root/free push -q origin main"; [ $? -eq 0 ] && ok "the last git -C decides (ungoverned push allowed)" || no "-C ordering reversed" "$(tail -2 $root/out)"
gr $F "cd $root/free | cat; git push origin HEAD:main"; [ $? -eq 126 ] && ok "a cd inside a pipeline does not carry a push out of its repository" || no "pipeline cd"

# ---- shell semantics ----
gr $root/p 'cd worktrees/feat'; [ "$GR_PWD" = "$F" ] && ok "cd is carried back to the shell" || no "cd carried back" "$GR_PWD"
gr $root 'exit 7'; [ $? -eq 7 ] && ok "exit status passes through" || no "exit status"
gr $root/p "cd $F; exit 0"; [ "$GR_PWD" = "$F" ] && ok "cd is carried back even when the command exits" || no "cd before exit" "$GR_PWD"
gr $root 'cat; echo done'; [ $? -eq 0 ] && [ "$(cat $root/out)" = done ] && ok "the command reads no input (not the wrapper's heredoc)" || no "stdin" "$(cat $root/out)"
state=$(/usr/bin/mktemp -t gr-e2e)
(cd $root && /usr/bin/python3 -I -B -X pycache_prefix=/var/empty/golden-rule "$runpy" --command "$(printf %s 'echo legacy' | /usr/bin/base64)" --state "$state") >"$root/out" 2>&1
[ $? -eq 0 ] && [ "$(cat $root/out)" = legacy ] && ok "the --command form from an older mod still runs" || no "--command form" "$(cat $root/out)"
/bin/rm -f "$state"

# ---- the mod's own wrapper, run by a shell as the Bash tool runs it ----
tricky=$'printf \'%s|\' "it\'s" \'$HOME\' "`echo tick`"\ncat <<\'EOF\'\n$HOME `x`\nEOF\necho GOLDEN_RULE_EOF\ncat <<\'X\'\nGOLDEN_RULE_EOF\nX'
expected=$(cd $root && /bin/zsh -c "$tricky")
wrapped=$(node --input-type=module -e "import { wrapCommand } from '$source_plugin/hooks/mod/shell.ts'; process.stdout.write(wrapCommand(process.argv[1], process.argv[2]))" "$plugin" "$tricky")
got=$(cd $root && /bin/zsh -c "$wrapped" 2>&1)
[ "$got" = "$expected" ] && ok "the mod's wrapper runs the command exactly as written" || no "wrapper fidelity" "$got"
[[ "$wrapped" == *"$tricky"* ]] && ok "the wrapper carries the command verbatim for other hooks to read" || no "wrapper verbatim"

# ---- linked main worktree ----
gr $L 'echo x > f && echo y >> README.md'; [ -z "$(git -C $L status --porcelain)" ] && ok "a linked main worktree's committable changes are reverted" || no "linked revert" "$(git -C $L status --porcelain)"
gr $L 'git -c user.email=e@e -c user.name=e commit -q --allow-empty -m x'; [ "$(git -C $L rev-parse HEAD)" = "$LHEAD" ] && ok "commit in a linked main worktree refused" || no "linked commit"
gr $root/l/base 'git checkout -q -b other'; [ $? -eq 0 ] && ok "the linked repository's own first checkout is not main and stays writable" || no "linked base checkout" "$(tail -2 $root/out)"

# ---- the guard's own files ----
gr $root "touch '$plugin/hooks/e2e-probe'"; [ ! -e "$plugin/hooks/e2e-probe" ] && ok "the plugin's own files refused" || { no "plugin files"; /bin/rm -f "$plugin/hooks/e2e-probe"; }
gr $root 'mkdir -p ~/.claude/skills/gr-e2e-probe/hooks'; [ -e ~/.claude/skills/gr-e2e-probe/hooks ] && ok "skills folders are no longer guarded" || no "skills hooks"
/bin/rm -rf ~/.claude/skills/gr-e2e-probe

[ -z "$(find $plugin -name __pycache__)" ] && ok "the guard writes no bytecode beside itself (nothing to plant)" || no "pycache written" "$(find $plugin -name __pycache__)"

print -- "\n$pass passed, $fail failed"
[ $fail -eq 0 ]
