#!/usr/bin/env bash
# Starts the batch task once on ECS Fargate, for manual end-to-end checks after `terraform apply`.
# Usage: infra/scripts/run-task.sh [--wait] <batch args...>
#   infra/scripts/run-task.sh run --sources google_maps
#   infra/scripts/run-task.sh --wait notify        # waits for the task to stop, exits with the container's exit code
# Cluster, task definition, subnets and security group come from `terraform output` of infra/envs/prod.
# Region and credentials come from the usual AWS env/profile. Needs the AWS CLI, terraform and jq, either
# on the host or in the tools container (`docker-compose run --rm tools`) with AWS credentials passed in.
set -euo pipefail

# Must match local.batch_container in infra/modules/salon_watcher/ecs.tf.
container="batch"

wait=0
if [[ "${1:-}" == "--wait" ]]; then
  wait=1
  shift
fi
if [[ $# -eq 0 ]]; then
  echo "usage: $0 [--wait] <batch args...>   e.g. $0 run --sources google_maps" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/../.." && pwd)"
tf() { terraform -chdir="$root/infra/envs/prod" output "$@"; }

cluster="$(tf -raw cluster_name)"
task_definition="$(tf -raw task_definition_arn)"
security_group="$(tf -raw security_group_id)"
subnets="$(tf -json subnet_ids | jq -r 'join(",")')"

overrides="$(jq -cn --arg name "$container" '{containerOverrides: [{name: $name, command: $ARGS.positional}]}' --args -- "$@")"

task_arn="$(aws ecs run-task \
  --cluster "$cluster" \
  --task-definition "$task_definition" \
  --launch-type FARGATE \
  --count 1 \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=ENABLED}" \
  --overrides "$overrides" \
  --query 'tasks[0].taskArn' --output text)"

if [[ -z "$task_arn" || "$task_arn" == "None" ]]; then
  echo "run-task failed: no task started" >&2
  exit 1
fi
echo "$task_arn"

if [[ $wait -eq 1 ]]; then
  aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn"
  exit_code="$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" \
    --query "tasks[0].containers[?name=='$container'].exitCode | [0]" --output text)"
  if [[ "$exit_code" == "None" ]]; then
    echo "task stopped without an exit code:" >&2
    aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" \
      --query 'tasks[0].[stopCode,stoppedReason]' --output text >&2
    exit 1
  fi
  echo "exitCode=$exit_code"
  exit "$exit_code"
fi
