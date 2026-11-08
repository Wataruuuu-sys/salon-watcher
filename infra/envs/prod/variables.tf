# Real values go in terraform.tfvars (never committed); see terraform.tfvars.example.
# The module rejects placeholder values containing example.com.
variable "owner_email" {
  description = "Alarm (SNS) recipient."
  type        = string
}

variable "notify_from" {
  description = "Sender of the daily mail (SES identity)."
  type        = string
}

variable "notify_to" {
  description = "Daily mail recipients, comma separated."
  type        = string
}

variable "cognito_domain_prefix" {
  description = "Cognito Hosted UI domain prefix (globally unique)."
  type        = string
}

variable "sources_disabled" {
  description = "Comma-separated sources the batch skips (\"threads\" until Meta App Review passes)."
  type        = string
  default     = ""
}

variable "batch_image_tag" {
  description = "Batch image tag in ECR."
  type        = string
  default     = "latest"
}
