# Public subnets only: tasks get a public IP and reach the internet (Neon, external APIs) through the
# internet gateway. No NAT gateway (fixed cost); nothing is allowed in.
data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "salon-watcher" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "salon-watcher" }
}

resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  availability_zone = data.aws_availability_zones.available.names[count.index]
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)

  tags = { Name = "salon-watcher-public-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "salon-watcher-public" }
}

# The only way out is the internet gateway (no aws_nat_gateway anywhere in this module).
resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Strip the VPC's default security group (it allows traffic from itself by default).
resource "aws_default_security_group" "default" {
  vpc_id  = aws_vpc.main.id
  ingress = []
  egress  = []
}

resource "aws_security_group" "batch" {
  name        = "salon-watcher-batch"
  description = "Batch tasks: outbound only, no inbound"
  vpc_id      = aws_vpc.main.id

  # Explicitly empty, so rules added outside Terraform are removed on the next apply.
  ingress = []

  egress = [{
    description      = "All outbound"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = []
    prefix_list_ids  = []
    security_groups  = []
    self             = false
  }]
}
