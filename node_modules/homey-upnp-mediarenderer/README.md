# Homey Generic UPnP Mediarenderer Driver

Generic driver to use UPnP Mediarenderer devices with Homey. Automatically registers speaker instance.

### installation
`npm install homey-upnp-mediarenderer`

example usage: 
```
'use strict';

const UpnpMediaRenderer = require('homey-upnp-mediarenderer');

class MyMediaRendererDriver extends UpnpMediaRenderer {

	constructor() {
		super();
		this.codecs = ['homey:codec:mp3'];
	}

	init(devices, callback) {
		this.scan();

		devices.forEach(this._initDevice.bind(this));

		callback();
	}

	_initDevice(deviceData) {
		const device = super._initDevice(deviceData);
		if (device) {
			// Device inited
		}
	}

	get capabilities() {
		// Get speaker capabilities from upnpMediaRenderer
		const capabilities = super.capabilities;
		// Capabilities can be added or overwritten here
		return capabilities;
	}

	pair(socket) {
		const scanLockInterval = setInterval(this.scan.bind(this, 10000), 9000);
		const parseDeviceData = (deviceInfo) => ({
			name: deviceInfo.description.friendlyName,
			data: {
				id: deviceInfo.headers.USN,
			},
		});
		const listDeviceListener = (deviceInfo) => socket.emit('list_devices', [parseDeviceData(deviceInfo)]);

		socket.on('list_devices', (data, callback) => {
			callback(null, this.getFoundDevices().map(parseDeviceData));
			this.on('found', listDeviceListener);
		});

		socket.on('disconnect', () => {
			this.removeListener('found', listDeviceListener);
			clearInterval(scanLockInterval);
		});
	}
}

module.exports = new MyMediaRendererDriver();
```

Homey UPnP Mediarenderer handles the capabilities and Speaker instance with Homey. To add custom logic you will need to override the function. 
Don't forget to call the super method so the logic of the generic driver will not break. For an example on how to do so, see `_initDevice` above.