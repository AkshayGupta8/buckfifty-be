# RDS/Aurora Postgres Instance

## Update the schema
1. Update the database schema /prisma/schema.prism
2. `npx prisma format`                                      # Format the new schema
3. `npx prism generate`                                     # Generate the new prisma client
4. `npx prisma migrate dev --name <name of the migration>`  # Migrate the db instance
5. `npx prisma studio --port 5555`                          # validate the migration at http://localhost:5555

# EC2 Instance Instructions (Back End Server)

## Update the server
1. `screen -ls`
2. `screen -r one`
3. `git pull`
4. `npm run build`
5. `npm run start`

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