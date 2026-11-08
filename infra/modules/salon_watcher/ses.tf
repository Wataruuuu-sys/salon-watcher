# Sender of the daily mail. While SES is in the sandbox, recipients must be verified too (docs/deploy.md).
resource "aws_sesv2_email_identity" "notify_from" {
  email_identity = var.notify_from
}
