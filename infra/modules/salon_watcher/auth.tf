# ---- Cognito: admin-created users only, Hosted UI with authorization code + PKCE ----
locals {
  cognito_authority = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

resource "aws_cognito_user_pool" "main" {
  name                = "salon-watcher"
  username_attributes = ["email"]
  # Users survive a mistaken destroy (CDK: RemovalPolicy.RETAIN).
  deletion_protection      = "ACTIVE"
  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "web"
  user_pool_id                         = aws_cognito_user_pool.main.id
  generate_secret                      = false
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["${local.site_url}/callback", "${local.site_url}/callback/"]
  logout_urls                          = [local.site_url]
}
