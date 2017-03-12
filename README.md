# ZeroDowntime

Tech challenge for [Mural](mural.co)

## Description

ZeroDowntime is an example of upgrading a Docker-containerized application without  downtime for end-users.

## Requirements

* Docker >1.10 and Docker Compose
* Ansible >2.0

**Notice:** the ```0.0.2``` tag of ```tactivos/devops-challenge``` does not exist in the tactivos DockerHub repository, and needs to be created locally for testing purposes by running ```docker build . -t tactivos/devops-challenge:0.0.2``` inside the ```docker/devops-challenge-v0.0.2``` directory.

## Setup

* Clone project sources
```bash
git clone https://github.com/ajfranzoia/zerodowntime
```

* Configure provision directory in ```ansible/app.yml``` vars section

* Run the full playbook on localhost (provision + upgrade from 0.0.1 to 0.0.2):
```bash
ansible-playbook -i "localhost," -c local ansible/app.yml -e "version=0.0.2" -vv
```

## Zero downtime verification


* Run only the provision role:
```bash
ansible-playbook -i "localhost," -c local ansible/app.yml -t provision -vv
```

* Launch the health check script in another terminal:
```bash
./scripts/health-check.sh
```

* Run only the upgrade role:
```bash
ansible-playbook -i "localhost," -c local ansible/app.yml -e "version=0.0.2" -t upgrade -vv
```

* Verify that the application had no downtime while upgrading in the health check output


## Design process and decisions

Initially I created the given compose file and launched the containers by running ```docker-compose up```. I verified that everything was working properly and that the ```You reached MURAL™ DevOps challenge sample app@0.0.1``` message was displayed. With this basic containerized application running, I created a simple bash health check script check with curl, that repeatedly checks against localhost  and the ```/ping``` endpoint to check that the application is live by inspecting the HTTP status code returned (see ```scripts/health-check.sh```):

In regard to the required upgraded, I had some previous experience with Docker and its Compose tool, but only for local development purposes. I hadn't worked in the past neither with any zero-downtime related patterns or implementations, nor with advanced topics like distributing and scaling. Hence, I started to research about these subjects, in order to gain insight as much as possible before beginning with a certain approach.

I read many related sites and articles. The exposed problems and the found solutions where really varied: nginx only solutions ([here](http://jasonwilder.com/blog/2014/03/25/automated-nginx-reverse-proxy-for-docker/),
[here](http://openmymind.net/Framework-Agnostic-Zero-Downtime-Deployment-With-Nginx/), and
[here](https://www.firelay.com/resources/blog/-/blogs/high-available-liferay-portal)),
docker in combination with nginx ([here](https://github.com/vincetse/docker-compose-zero-downtime-deployment)), docker + ansible + haproxy ([here](https://www.perimeterx.com/blog/zero-downtime-deployment-with-docker/)),
docker + haproxy ([here](https://medium.com/@korolvs/zero-downtime-deployment-with-docker-d9ef54e48c4#.2ck1p9ahj)),
docker + haproxy + custom tool ([here](https://docs.quay.io/solution/zero-downtime-deployments.html)), docker + haproxy
([here](https://blog.tutum.co/2015/06/08/blue-green-deployment-using-containers/http://blog.hypriot.com/post/docker-compose-nodejs-haproxy/)), nginx + ansible ([here](http://steinim.github.io/slides/zero-downtime-ansible/#/11), [here](https://sysadmincasts.com/episodes/47-zero-downtime-deployments-with-ansible-part-4-4)), etc.

Inspired mainly by http://openmymind.net/Framework-Agnostic-Zero-Downtime-Deployment-With-Nginx/ and https://github.com/vincetse/docker-compose-zero-downtime-deployment, I decided to follow the Blue-Green deployment pattern (brief explanation can be found [here] (https://martinfowler.com/bliki/BlueGreenDeployment.html)) and setting up a nginx instance as a reverse proxy for application.

At first I decided to start with a pure nginx approach on my localhost. I configured nginx as a reverse proxy in front of two application containers, which I would spin up manually. The ```upstream``` directive enables nginx to act as a load balancing and distribute traffic to several servers.


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

With whis fully functional applications setup, I manually run the steps to simulate  a an upgrade (I had previously created the ```0.0.2``` tag locally, since it wasn't created in the [tactivos images repository](https://hub.docker.com/r/tactivos/devops-challenge/tags/), see notice above):

* Marked the first app as offline by using the ```down``` directive in the ```upstream``` block of the nginx config (which tells nginx to mark the node as unavailable and stop sending requests, see http://nginx.org/en/docs/http/ngx_http_upstream_module.html):
```nginx
upstream app_upstream {
  server app_1:3000 down;
  server app_2:3001;
  keepalive 32;
}
```
* Reloaded nginx by running ```service nginx reload``` and verified that requests were still served properly.

* Marked the first app as online and the second app as offline, and reloaded nginx again. Requests were served properly again as expected:
```nginx
upstream app_upstream {
  server app_1:3000;
  server app_2:3001 down;
  keepalive 32;
}
```

By having the health check script running simultaneously while carrying out these steps I could verify that the zero downtime was achieved, and the application remained responsive  during the upstream switch. Nginx allows this process by gracefully managing open connections when reloading and waits for an upstream node to finish handling requests before removing it from the pool.

Afterwards, I ported this solution to a full docker-compose schema, having the nginx proxy as another service container (whichs grants the same benefits of containerizing apps, specially for future portability and removes the need of having previously installed nginx in the target machine). This was the resulting ```docker-compose.yml``` file:

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

The upstream in the nginx config is modified to benefit from the service links provided by docker compose:

```nginx
upstream app_upstream {
  server app_1:3000;
  server app_2:3000;
  keepalive 32;
}
```

With this approach I simply had to switch up and down containers through docker-compose. The steps I planned when a version upgrade needed to take place were the following:
* Launch and wait containers to be ready with ```docker-compose up -d```
* Mark app #1 in upstream as down in the proxy config
* Update app #1 image version to ```0.0.2``` in ```docker-compose.yml```
* Stop and recreate app #1 service with ```docker-compose stop app_1``` and ```docker-compose up -d --no-deps app_1```
* Wait until service ap #1 is recreated
* Mark app #1 in upstream as up in proxy config
* Repeat same steps for app #2

I run manually this solution, step by step, the zero downtime was achieved again. Requests where served by the app #2 container while app #1 container was being upgrade, and viceversa.

After this I decided to automate the solution, but instead of creating a bash script I went for an Ansible solution, which I realized that would result in a more manageable implementation, since one of Ansible's purposes is automating IT configuration and deployments.

I started designing an upgrade playbook and running it in my localhost, for the purpose of the required solution. At first, the playbook tasks were defined in a single file but then I refactored them it into smaller tasks by using includes to keep the solution DRY. I launched services with the ```docker-compose up -d``` command, and then run the upgrade playbook by running ```ansible-playbook -i "localhost," -c local ansible/app.yml -vv```.

The main Ansible tasks can be found below:

* recreate-service task (stops and recreates a container):
```yaml
- name: Stop app service {{ app_id }}
  shell: docker-compose -f {{ compose_file }} stop app_{{ app_id }}

- name: Recreate app service {{ app_id }}
  shell: docker-compose -f {{ compose_file }} up -d --no-deps app_{{ app_id }}
```

* update-compose task (updates the docker-compose.yml file):
```yaml
- name: Update docker-compose.yml
  template: src=docker-compose.yml.j2 dest={{ compose_file }}
```

* update-nginx-conf task (updates the nginx default.conf file and reloads the nginx process in the proxy container):
```yaml
- name: Update nginx config
  template: src=default.conf.j2 dest={{ nginx_conf_file }}

- name: reload nginx container
  shell: docker-compose -f {{ compose_file }} exec -T proxy service nginx reload
```

I verified that the services were updated like in the previous solution and that the zero downtime was achieved. I solved some issues when execution docker-compose via Ansible (as described in https://github.com/docker/compose/issues/3352), but solved them by using the ```-T``` option. I also refactored and allowed the version-to-upgrade value to be configurable as a command line argument when running the Ansible playbook.

Moreover, I separated the full provision + upgrade playbook by adding roles and tags, in order to run them in a separate way if needed (useful to manually verify the zero downtime requirement, see above).

<br />
***
<br />

## Bonus point #1

> Explain how you would limit/control the amount of compute/memory resources accessible by any member of your solution.

Since the members of the solution are Docker containers, the resources accesible by them can be controlled by configuration (as stated on the [official Docker documentation](https://docs.docker.com/engine/admin/resource_constraints/)). Docker provides ways to control memory, CPU, and block IO. The list of available parameters available for a service in a ```docker-compose.yml``` file can be found [here](https://docs.docker.com/compose/compose-file/compose-file-v2/#cpushares-cpuquota-cpuset-domainname-hostname-ipc-macaddress-memlimit-memswaplimit-memswappiness-oomscoreadj-privileged-readonly-restart-shmsize-stdinopen-tty-user-workingdir).

Example of setting resources constraints in a ```docker-compose.yml``` file:

```yaml
services:
  app:
    #..
    cpu_quota: 50000 # control CPU CFS microseconds quota
    mem_limit: 4m # limit memory to 4 megabytes
  db:
    #...
    mem_swappiness: 50 # percentage of memory swapiness
    cpuset: 1,3 # use the second and fourth CPU only

```
