variable "owner_email" {
  description = "Alarm (SNS) recipient."
  type        = string

  validation {
    condition     = !strcontains(var.owner_email, "example.com")
    error_message = "owner_email is a placeholder (example.com)."
  }
}

variable "notify_from" {
  description = "Sender of the daily mail; registered as an SES identity."
  type        = string

  validation {
    condition     = !strcontains(var.notify_from, "example.com")
    error_message = "notify_from is a placeholder (example.com)."
  }
}

variable "notify_to" {
  description = "Daily mail recipients, comma separated."
  type        = string

  validation {
    condition     = !strcontains(var.notify_to, "example.com")
    error_message = "notify_to is a placeholder (example.com)."
  }
}

variable "cognito_domain_prefix" {
  description = "Cognito Hosted UI domain prefix (globally unique)."
  type        = string

  validation {
    condition     = !strcontains(var.cognito_domain_prefix, "example.com")
    error_message = "cognito_domain_prefix is a placeholder (example.com)."
  }
}

variable "sources_disabled" {
  description = "Comma-separated sources the batch skips (e.g. \"threads\" until App Review passes)."
  type        = string
  default     = ""

  validation {
    condition     = !strcontains(var.sources_disabled, "example.com")
    error_message = "sources_disabled is a placeholder (example.com)."
  }
}

variable "batch_image_tag" {
  description = "Tag of the batch image in ECR (pushed by infra/scripts/push-batch-image.sh)."
  type        = string
  default     = "latest"
}

variable "api_zip_path" {
  description = "API Lambda bundle (`npm -w backend run bundle:api` writes backend/dist/api.zip)."
  type        = string
}

variable "classify_model_id" {
  description = "Claude model the Threads classifier calls on Claude in Amazon Bedrock: Haiku 5.5, or one of its inference profiles (e.g. \"jp.anthropic.claude-haiku-5-5\")."
  type        = string
  default     = "anthropic.claude-haiku-5-5"

  # The task role may only invoke Haiku 5.5 (iam.tf), so other models would fail at run time.
  validation {
    condition     = can(regex("^([a-z]+\\.)?anthropic\\.claude-haiku-5-5$", var.classify_model_id))
    error_message = "classify_model_id must be anthropic.claude-haiku-5-5 or one of its inference profiles."
  }
}

variable "bedrock_region" {
  description = "AWS region of the Bedrock endpoint the classifier calls; null means the provider region."
  type        = string
  default     = null
}
