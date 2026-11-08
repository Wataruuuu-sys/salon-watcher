#!/usr/bin/env bash
# Builds the frontend with the values from `terraform apply` (infra/envs/prod), uploads frontend/out
# to the site bucket and invalidates CloudFront. Run after every apply that changes these outputs and
# after frontend changes. Needs terraform, node/npm and the AWS CLI with credentials for the account.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
tf() { terraform -chdir="$root/infra/envs/prod" output -raw "$1"; }

site_url="$(tf site_url)"
bucket="$(tf site_bucket)"
distribution_id="$(tf distribution_id)"

# Assigned before export so a failing `terraform output` stops the script (set -e).
NEXT_PUBLIC_API_URL="$(tf api_url)"
NEXT_PUBLIC_COGNITO_AUTHORITY="$(tf cognito_authority)"
NEXT_PUBLIC_COGNITO_CLIENT_ID="$(tf cognito_client_id)"
NEXT_PUBLIC_REDIRECT_URI="$site_url/callback/"
export NEXT_PUBLIC_API_URL NEXT_PUBLIC_COGNITO_AUTHORITY NEXT_PUBLIC_COGNITO_CLIENT_ID NEXT_PUBLIC_REDIRECT_URI
# Production builds always use Cognito; never carry the dev bypass into a release build.
unset NEXT_PUBLIC_AUTH_MODE

npm --prefix "$root" -w frontend run build
aws s3 sync "$root/frontend/out" "s3://$bucket" --delete
aws cloudfront create-invalidation --distribution-id "$distribution_id" --paths '/*' >/dev/null
echo "deployed $site_url"
