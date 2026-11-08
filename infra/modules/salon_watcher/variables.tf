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

# Toggles for environments that cannot host every service (LocalStack, Task 8).
variable "create_cognito" {
  type    = bool
  default = true
}

variable "create_api" {
  type    = bool
  default = true
}

variable "create_site" {
  type    = bool
  default = true
}

variable "create_scheduler" {
  type    = bool
  default = true
}
