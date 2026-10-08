#!/usr/bin/env bash
# Starts the office in its container (deploy/container/Dockerfile): sshd on port 22, its database
# (PostgreSQL on the volume, unless DATABASE_URL names one), then the office as agentoffice on
# 127.0.0.1:4600.
#
# Everything that has to outlive a restart or a redeploy lives on the volume at /data:
#   /data/home   agentoffice's home: the office's folder ~/agent-office (workers' worktrees, each
#                account's Claude and GitHub logins), the projects in ~/workspace, Claude Code and its
#                sign-in (~/.local, ~/.claude, ~/.claude.json), the GitHub CLI's (~/.config/gh), ~/.gitconfig
#   /data/postgres  the office's database (password, accounts and everyone's settings, floors, chat),
#                when DATABASE_URL doesn't name one somewhere else
#   /data/ssh    the SSH host key, so ssh keeps trusting the office after a redeploy
#   /data/team   teammates' keys (office's authorized_keys), from 👥 Invite teammates
set -euo pipefail
DATA=/data
RUN_USER=agentoffice
RUN_HOME=$DATA/home
RUN_PATH=$RUN_HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

AS_USER=(setpriv --reuid=$RUN_USER --regid=$RUN_USER --init-groups
  env HOME=$RUN_HOME USER=$RUN_USER LOGNAME=$RUN_USER SHELL=/bin/bash PATH="$RUN_PATH")

say() { echo "agent-office-container: $*"; }

mountpoint -q $DATA || say "nothing is mounted on $DATA: the office forgets everything when this container goes"
# sshd refuses keys under a directory others can write to.
install -d -m 755 -o root -g root $DATA $DATA/team
install -d -m 700 -o root -g root $DATA/ssh
[[ -f $DATA/team/authorized_keys ]] || install -m 644 -o root -g root /dev/null $DATA/team/authorized_keys
if [[ ! -f $DATA/ssh/ssh_host_ed25519_key ]]; then
  say "making the SSH host key (first start)"
  ssh-keygen -q -t ed25519 -N '' -C agent-office -f $DATA/ssh/ssh_host_ed25519_key
fi
install -m 600 $DATA/ssh/ssh_host_ed25519_key /etc/ssh/ssh_host_ed25519_key
install -m 644 $DATA/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ed25519_key.pub
install -d -m 755 /etc/agent-office
printf '%s\n' "${AGENT_OFFICE_ADMIN_KEYS:-}" >/etc/agent-office/admin_keys
chmod 644 /etc/agent-office/admin_keys
unset AGENT_OFFICE_ADMIN_KEYS

install -d -m 755 -o $RUN_USER -g $RUN_USER $RUN_HOME
for f in .bashrc .profile; do
  [[ -e $RUN_HOME/$f ]] || install -m 644 -o $RUN_USER -g $RUN_USER /etc/skel/$f $RUN_HOME/$f
done
cd $RUN_HOME

# The address teammates SSH to: Railway's TCP proxy in front of port 22 (host:port). deploy/fly.sh
# sets it itself: the app's IPv4 address and its port.
if [[ -z "${AGENT_OFFICE_PUBLIC_HOST:-}" && -n "${RAILWAY_TCP_PROXY_DOMAIN:-}" && -n "${RAILWAY_TCP_PROXY_PORT:-}" ]]; then
  export AGENT_OFFICE_PUBLIC_HOST=$RAILWAY_TCP_PROXY_DOMAIN:$RAILWAY_TCP_PROXY_PORT
fi
# On Fly.io, port 22 is Fly's own SSH server (`fly ssh console`), so deploy/fly.sh moves this one.
SSHD_PORT=${AGENT_OFFICE_SSHD_PORT:-22}
[[ "$SSHD_PORT" =~ ^[0-9]+$ ]] || SSHD_PORT=22

mkdir -p /run/sshd
/usr/sbin/sshd -t
# Brought back if it ever dies, so the tunnels keep working.
(while :; do /usr/sbin/sshd -D -e -p "$SSHD_PORT"; sleep 2; done) &
say "sshd is listening on port $SSHD_PORT${AGENT_OFFICE_PUBLIC_HOST:+ (reached at $AGENT_OFFICE_PUBLIC_HOST)}"

# The office's database: the one DATABASE_URL names, or PostgreSQL here, with its data on the volume,
# which agentoffice signs in to by its Unix socket.
if [[ -z "${DATABASE_URL:-}" ]]; then
  PG_BIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
  PG_DATA=$DATA/postgres
  install -d -m 700 -o postgres -g postgres $PG_DATA
  install -d -m 2775 -o postgres -g postgres /var/run/postgresql
  if [[ ! -f $PG_DATA/PG_VERSION ]]; then
    say "making the office's database in $PG_DATA (first start)"
    setpriv --reuid=postgres --regid=postgres --init-groups "$PG_BIN/initdb" -D $PG_DATA -U postgres -A peer -E UTF8 >/dev/null
  fi
  setpriv --reuid=postgres --regid=postgres --init-groups "$PG_BIN/pg_ctl" -D $PG_DATA -w -l $PG_DATA/server.log \
    -o "-c listen_addresses='' -c unix_socket_directories=/var/run/postgresql" start >/dev/null
  pg() { setpriv --reuid=postgres --regid=postgres --init-groups psql -h /var/run/postgresql -U postgres -qtAc "$1"; }
  pg "select 1 from pg_roles where rolname = '$RUN_USER'" | grep -q 1 || pg "create role $RUN_USER login"
  pg "select 1 from pg_database where datname = 'agent_office'" | grep -q 1 || pg "create database agent_office owner $RUN_USER"
  export DATABASE_URL="postgresql://$RUN_USER@/agent_office?host=/var/run/postgresql"
  say "the office's database is PostgreSQL on the volume"
fi
# Where `agent-office` run over ssh (accounts, --reset-password) finds the same database.
"${AS_USER[@]}" sh -c 'umask 077; mkdir -p "$1"; f="$1/.env"; touch "$f"; grep -v "^DATABASE_URL=" "$f" >"$f.new" || true; printf "DATABASE_URL=\"%s\"\n" "$2" >>"$f.new"; mv "$f.new" "$f"' sh $RUN_HOME/agent-office "$DATABASE_URL"

if [[ ! -x $RUN_HOME/.local/bin/claude ]]; then
  say "installing Claude Code in $RUN_HOME/.local (first start)"
  "${AS_USER[@]}" bash -c 'curl -fsSL https://claude.ai/install.sh | bash' >/dev/null ||
    say "couldn't install Claude Code; it's tried again at the next start"
fi
"${AS_USER[@]}" mkdir -p $RUN_HOME/workspace
# Unless one was picked already: after the first time, the folder is the admins' to move in ⚙️ Settings.
"${AS_USER[@]}" node /opt/agent-office/bin/agent-office.js setup --default-projects $RUN_HOME/workspace </dev/null
"${AS_USER[@]}" node /usr/local/lib/agent-office/onboard.js $RUN_HOME/workspace

exec "${AS_USER[@]}" node /opt/agent-office/bin/agent-office.js --host 127.0.0.1 --port 4600 --no-open
