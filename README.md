# ZeroDowntime

Tech challenge for [Mural](mural.co)

## Description

ZeroDowntime is an example of upgrading a Docker-containerized application without  downtime for end-users.


## Design process and decisions

Initially I created the given compose file and launched the containers by running ```docker-compose up```. I verified that everything was working properly and that the ```You reached MURAL™ DevOps challenge sample app@0.0.1``` message was displayed. With this basic containerized application running, I created a simple bash health check script check with curl, that repeatedly checks against localhost  and the ```/ping``` endpoint to check that the application is live by inspecting the HTTP status code returned (see ```scripts/health-check.sh```):

In regard to the required upgraded, I had some previous experience with Docker and its Compose tool, but only for local development purposes. I hadn't worked in the past neither with any zero-downtime related patterns or implementations, nor with advanced topics like distributing and scaling. Hence, I started to research about these subjects, in order to gain insight as much as possible before beginning with a certain approach.

I read many related sites and articles. The exposed problems and the found solutions where really varied: they ranged from nginx only solutions (http://jasonwilder.com/blog/2014/03/25/automated-nginx-reverse-proxy-for-docker/,
http://openmymind.net/Framework-Agnostic-Zero-Downtime-Deployment-With-Nginx/
https://www.firelay.com/resources/blog/-/blogs/high-available-liferay-portal),
docker in combination with nginx (https://github.com/vincetse/docker-compose-zero-downtime-deployment), docker + ansible + haproxy (https://www.perimeterx.com/blog/zero-downtime-deployment-with-docker/),
docker + haproxy  (https://medium.com/@korolvs/zero-downtime-deployment-with-docker-d9ef54e48c4#.2ck1p9ahj),
docker + haproxy + custom tool (https://docs.quay.io/solution/zero-downtime-deployments.html), docker + haproxy
(https://blog.tutum.co/2015/06/08/blue-green-deployment-using-containers/http://blog.hypriot.com/post/docker-compose-nodejs-haproxy/), nginx + ansible (http://steinim.github.io/slides/zero-downtime-ansible/#/11
https://sysadmincasts.com/episodes/47-zero-downtime-deployments-with-ansible-part-4-4), etc.

Inspired mainly by http://openmymind.net/Framework-Agnostic-Zero-Downtime-Deployment-With-Nginx/ and https://github.com/vincetse/docker-compose-zero-downtime-deployment, I decided to follow the Blue-Green deployment pattern (basic explanation can be found [here] (https://martinfowler.com/bliki/BlueGreenDeployment.html)) and went for a containerized nginx reverse proxy within the compose schema.

At first I decided to start with a pure nginx approach on my localhost. I configured nginx as a reverse proxy in front of two  application containers, which I would spin up manually.

* Application containers launching:

```bash
# First container
docker run --rm -p 3000:3000 tactivos/devops-challenge:0.0.1

# Second container
docker run --rm -p 3001:3000 tactivos/devops-challenge:0.0.1
```

* nginx reverse proxy configuration:

```nginx
upstream app_upstream {
  server app_1:3000;
  server app_2:3001;
  keepalive 32;
}

server {
  listen 8000;

  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_next_upstream error timeout;

  location / {
    proxy_pass http://app_upstream;
  }
}
```

With whis fully functional applications setup, I manually run the steps to simulate  a an upgrade (I had previously created the 0.0.2 tag locally, since it wasn't created in the [tactivos images repository](https://hub.docker.com/r/tactivos/devops-challenge/tags/)):
* Marked the first app as offline by using the ```down``` directive in the ```upstream``` block of the nginx config (which tells nginx to mark the node as unavailable and stop sending requests, see http://nginx.org/en/docs/http/ngx_http_upstream_module.html):
```nginx
upstream app_upstream {
  server app_1:3000 down;
  server app_2:3001;
  keepalive 32;
}
```
* Reloaded nginx by running ```service nginx reload``` and verified that requests were still served.
* Marked the first app as online and the second app as offline, and reloaded nginx again. Requests were served properly again:
```nginx
upstream app_upstream {
  server app_1:3000;
  server app_2:3001 down;
  keepalive 32;
}
```

By having the health check script running while carrying out these steps I could verify that the zero downtime was achieved, and the application remained responsive  during the switch. Nginx allows this process because gracefully handles connections  when reloading and waits for an upstream node to finish handling requests before removing it from the pool.

Afterwards, I ported this solution to a full docker-composed schema, and having the nginx  proxy as another service container. Having nginx as a container would grant the same benefits of containerizing apps, specially for portability, and would remove the need of having installed nginx in the host machine previously. This was the resulting ```docker-compose.yml``` file:

```yaml
version: "2"

services:
  proxy:
    image: nginx:1.11
    ports:
      - "8000:80"
    volumes:
      - ./nginx/:/etc/nginx/conf.d/

  app_1:
    image: tactivos/devops-challenge:0.0.1
    depends_on:
      - db
    ports:
      - "3000"

  app_2:
    image: tactivos/devops-challenge:0.0.1
    depends_on:
      - db
    ports:
      - "3000"

  db:
    image: mongo
```

With this approach, I would then have to switch up and down containers through docker-compose. The steps I devised when a version upgrade needed to take place where:
* Launch and wait containers to be ready with ```docker-compose up -d```
* Mark app_1 in upstream as down in proxy config
* Update image version to 0.0.2 for app_1 service in ```docker-compose.yml```
* Stop and recreate service for app_1 ```docker-compose.yml``` with ```docker-compose stop app_1``` and ```docker-compose up -d --no-deps app_1```
* Wait until service app_1 is recreated
* Mark app_1 in upstream as up in proxy config
* Repeat same steps for app 2

I tried manually step by step this solution, and again the zero downtime was achieved. Requests where served by the app_2 container while app_1 was upgrading, and viceversa.

After this I decided to automate this solution, but instead of creating a bash script I went for an Ansible solution, which would result in a more manageable implementation which I had read that was a good choice for automating configuration and deployments.
