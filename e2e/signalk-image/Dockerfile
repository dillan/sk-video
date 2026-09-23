# Signal K server plus signalk-container, which the plugin uses to run the video toolchain.
FROM signalk/signalk-server:latest
USER node
WORKDIR /home/node/.signalk
RUN npm install signalk-container
