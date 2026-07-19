#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=/opt/nightly
ARCHIVE=/tmp/nightly-source.tar.gz
NODE_VERSION=v22.17.0
NODE_DIST=node-${NODE_VERSION}-linux-x64
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"

test -f "${ARCHIVE}"

sudo install -d -o ubuntu -g ubuntu "${APP_ROOT}/releases"

if [[ ! -x "${APP_ROOT}/node/bin/node" ]] || [[ "$("${APP_ROOT}/node/bin/node" --version)" != "${NODE_VERSION}" ]]; then
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' EXIT
  curl -fsSLo "${tmp_dir}/${NODE_DIST}.tar.xz" "https://nodejs.org/dist/${NODE_VERSION}/${NODE_DIST}.tar.xz"
  curl -fsSLo "${tmp_dir}/SHASUMS256.txt" "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
  expected="$(grep " ${NODE_DIST}.tar.xz$" "${tmp_dir}/SHASUMS256.txt")"
  printf '%s\n' "${expected}" | (cd "${tmp_dir}" && sha256sum -c -)
  tar -xJf "${tmp_dir}/${NODE_DIST}.tar.xz" -C "${tmp_dir}"
  sudo rm -rf "${APP_ROOT}/node.new"
  sudo mv "${tmp_dir}/${NODE_DIST}" "${APP_ROOT}/node.new"
  sudo chown -R root:root "${APP_ROOT}/node.new"
  if [[ -e "${APP_ROOT}/node" ]]; then
    sudo mv "${APP_ROOT}/node" "${APP_ROOT}/node.previous"
  fi
  sudo mv "${APP_ROOT}/node.new" "${APP_ROOT}/node"
fi

install -d "${RELEASE_DIR}"
tar -xzf "${ARCHIVE}" -C "${RELEASE_DIR}"

export PATH="${APP_ROOT}/node/bin:${PATH}"
cd "${RELEASE_DIR}"
npm ci
npm run build

sudo ln -sfn "${RELEASE_DIR}" "${APP_ROOT}/current.new"
sudo mv -Tf "${APP_ROOT}/current.new" "${APP_ROOT}/current"

sudo install -m 0644 deploy/nightly.service /etc/systemd/system/nightly.service
sudo install -m 0644 deploy/nightly.nginx.conf /etc/nginx/conf.d/nightly.conf

if ! sudo grep -Fq 'include /etc/nginx/conf.d/*.conf;' /etc/nginx/nginx.conf; then
  sudo cp /etc/nginx/nginx.conf "/etc/nginx/nginx.conf.pre-nightly-${RELEASE_ID}"
  sudo sed -i '$i\    include /etc/nginx/conf.d/*.conf;' /etc/nginx/nginx.conf
fi

sudo systemctl daemon-reload
sudo systemctl enable --now nightly.service
sudo systemctl restart nightly.service

for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null "http://127.0.0.1:30082/have/nightly"; then
    break
  fi
  sleep 1
done

curl -fsS -o /dev/null "http://127.0.0.1:30082/have/nightly"
sudo nginx -t
sudo systemctl reload nginx

echo "RELEASE_ID=${RELEASE_ID}"
echo "NODE_VERSION=$(node --version)"
echo "SERVICE_STATUS=$(systemctl is-active nightly.service)"
