npx prism generate
npx prisma migrate dev

npm run dev


# EC2 Instance Instructions

## Update the server
1. `git pull`
2. `npm run build`
3. `npm run start`

## Cloudwatch Agent

### Is the agent running
1. `sudo systemctl status amazon-cloudwatch-agent`

### Is the agent enabled to start on boot
1. `sudo systemctl is-enabled amazon-cloudwatch-agent`

### Enable the agent to start on boot
1. `sudo systemctl enable amazon-cloudwatch-agent`

### Manually restart the agent
1. `sudo systemctl start amazon-cloudwatch-agent`

## Networking
- There's an A Record at http://new-be.buckfifty-ai-herdmanager.click that points to the public ip address of the ec2 instance
- Rather than setup a reverse proxy, I ran `sudo setcap 'cap_net_bind_service=+ep' /usr/bin/node` to allow the express server to override linux marking port 80 as priveledged
- To Do: setup the reverse proxy, and create an SSL/TLS certificate to serve traffic over https