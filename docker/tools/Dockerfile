# Dev tooling: Node 22 (tests), Terraform, AWS CLI v2.
# Build context is the repo root (docker-compose `tools`); the repo itself is bind-mounted at /app.
FROM node:22-bookworm-slim

ARG TERRAFORM_VERSION=1.16.7
ARG AWSCLI_VERSION=2.39.2

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip git jq \
 && rm -rf /var/lib/apt/lists/*

# Terraform, checked against HashiCorp's published SHA256SUMS.
RUN arch="$(dpkg --print-architecture)" \
 && zip="terraform_${TERRAFORM_VERSION}_linux_${arch}.zip" \
 && cd /tmp \
 && curl -fsSLO "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/${zip}" \
 && curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_SHA256SUMS" \
      | grep " ${zip}\$" | sha256sum -c - \
 && unzip -q "${zip}" terraform -d /usr/local/bin \
 && rm "${zip}"

# AWS CLI v2 (official installer).
RUN case "$(dpkg --print-architecture)" in amd64) a=x86_64 ;; arm64) a=aarch64 ;; *) exit 1 ;; esac \
 && cd /tmp \
 && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${a}-${AWSCLI_VERSION}.zip" -o awscli.zip \
 && unzip -q awscli.zip \
 && ./aws/install \
 && rm -rf aws awscli.zip

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Linux node_modules for the bind-mounted repo (kept in compose volumes, shared with api / frontend).
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --workspace frontend
