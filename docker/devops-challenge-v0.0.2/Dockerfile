FROM node:6

RUN apt-get update && \
  apt-get install -y libkrb5-dev && \
  npm config set python python2.7

# Include `mural` source
COPY package.json /usr/src/

# Navigate to source path
WORKDIR /usr/src

# Install prod (i.e.: runtime) dependencies natively and clean up source.
RUN npm install --quiet --unsafe-perm

COPY . /usr/src/

ENV PORT=3000

EXPOSE 3000

CMD ["node", "index.js"]
