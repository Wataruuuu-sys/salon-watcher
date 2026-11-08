#!/usr/bin/env bash
# Builds the batch image (Dockerfile `batch` stage, linux/arm64) and pushes it to the ECR repository
# created by infra/envs/prod. Usage: infra/scripts/push-batch-image.sh [tag]   (default: git short SHA)
# The image is also tagged `latest`, which the task definition uses unless batch_image_tag is set.
# Needs docker and the AWS CLI with credentials for the target account; the repository URL comes from
# `terraform output` (or set ECR_REPOSITORY_URL to skip Terraform).
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
tag="${1:-$(git -C "$root" rev-parse --short HEAD)}"
repo="${ECR_REPOSITORY_URL:-$(terraform -chdir="$root/infra/envs/prod" output -raw ecr_repository_url)}"
registry="${repo%%/*}"
# <account>.dkr.ecr.<region>.amazonaws.com
region="$(echo "$registry" | cut -d. -f4)"

aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry"
docker build --platform linux/arm64 --target batch -t "$repo:$tag" -t "$repo:latest" "$root"
docker push "$repo:$tag"
docker push "$repo:latest"
echo "pushed $repo:$tag (and :latest)"
