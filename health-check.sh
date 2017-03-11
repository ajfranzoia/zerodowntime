#!/bin/sh

APP_PORT=8009
APP_URL="http://localhost:$APP_PORT/ping"
CHECK_INTERVAL=0.05

echo "Running app health check on $APP_URL"

while true; do
	sleep $CHECK_INTERVAL
	result=$(curl -sL -w "%{http_code}\\n" $APP_URL -o /dev/null)

	if [ "$result" != "200" ]; then
		echo "Application is down!"
		exit 1
	else
		printf "."
	fi
done
