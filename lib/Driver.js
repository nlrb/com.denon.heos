'use strict';

const events = require('events');

const UpnpMediaRenderer = require('homey-upnp-mediarenderer');

const DenonHeos = require('denon-heos').DenonHeos;

class Driver extends UpnpMediaRenderer {

	constructor() {
		super();
		this.codecs = ['homey:codec:mp3'];

		this._devices = {};
		// this._foundHeosDevices = {};

		Homey.on('unload', () => {
			this.log('Disconnecting all players...');
			for (let deviceId in this._devices) {
				let device = this._devices[deviceId];
				if (device.instance.disconnect) {
					device.instance.disconnect();
				}
			}
		})

	}

	log() {
		console.log.bind(null, `[log][DenonHeos]`).apply(null, arguments);
	}

	_initDevice(deviceData) {
		if (deviceData.id.length < 36) {
			return this.setUnavailable('Device needs to be re-paired.')
		}
		const device = super._initDevice(deviceData);
		if (device) {
			device.heosState = {
				speaker_playing: false,
				volume_set: 1
			};
			device.instance = new DenonHeos(device.info.address);

			device.instance.on('error', () => this.setUnavailable(device));
			device.instance.connect(err => {
				if (err) return this.setUnavailable(deviceData, err);

				device.instance.playerGetPlayers((err, players) => {
					if (err) return this.setUnavailable(deviceData, err);

					// find playerId by IP
					if (!Array.isArray(players.payload)) return;

					players.payload.forEach(player => {
						if (player.ip === device.info.address) {
							device.playerId = player.pid.toString();
							device.groupId = ( player.gid ) ? player.gid.toString() : false;
						}
					});

					if (!device.playerId) return;

					this.setAvailable(deviceData);

					// get volume
					device.instance.playerGetVolume(device.playerId, (err, result) => {
						if (err) return console.error(err);

						let volume = result.message.level / 100;

						device.heosState['volume_set'] = volume;
						console.log('realtime volume', volume);
						this.realtime(deviceData, 'volume_set', volume);
					});

					// on volume
					device.instance.on('player_volume_changed', (message) => {
						if (message.pid !== device.playerId) return;

						let volume = ( parseInt(message.level) / 100 );
						if (volume !== device.heosState['volume_set']) {
							device.heosState['volume_set'] = volume;
							console.log('realtime volume2', volume);
							this.realtime(deviceData, 'volume_set', volume);
						}

					});

					// get state
					device.instance.playerGetPlayState(device.playerId, (err, result) => {
						if (err) return console.error(err);

						let speaker_playing = result.message.heosState === 'play';

						device.heosState['speaker_playing'] = speaker_playing;
						this.realtime(deviceData, 'speaker_playing', speaker_playing);
					});

					// on state
					device.instance.on('player_state_changed', (message) => {
						if (message.pid !== device.playerId
							&& message.pid !== device.groupId) return;

						let speaker_playing = ( message.heosState === 'play' );
						if (speaker_playing !== device.heosState['speaker_playing']) {
							device.heosState['speaker_playing'] = speaker_playing;
							this.realtime(deviceData, 'speaker_playing', speaker_playing);
						}

						// update others in group as well
						if (device.groupId) {
							for (let deviceId in this._devices) {
								let device_ = this._devices[deviceId];
								if (device_.groupId === device.groupId) {
									device_.heosState['speaker_playing'] = speaker_playing;
									this.realtime(device_.deviceData, 'speaker_playing', speaker_playing);
								}
							}
						}
					});

					device.instance.on('groups_changed', (message) => {
						device.instance.playerGetPlayerInfo(device.playerId, (err, player) => {
							if (err) return console.error(err);
							if (!player.payload) return;

							device.groupId = ( player.payload.gid ) ? player.payload.gid.toString() : false;

							this.log('Player', device.playerId, 'is now in group', device.groupId);
						});
					});

				});

			});
		}
	}

	_uninitDevice(device){
		device.instance.disconnect();
		super._uninitDevice(device);
	}

	/*
	 Exports
	 */
	init(devicesData, callback) {
		super.init(devicesData, callback);

		// this._discover = new Discover();
		// this._discover.start();
		// this._discover.on('device', device => {
		// 	this.log(`Found device`, device);
		// 	this._foundHeosDevices[device.wlanMac] = device;
		// 	this.emit(`device:${device.wlanMac}`)
		// });

	}

	pair(socket) {
		const scanLockInterval = setInterval(this.scan.bind(this, 10000), 9000);
		const parseDeviceData = (deviceInfo) => ({
			name: deviceInfo.description.friendlyName,
			data: {
				id: deviceInfo.description.UDN,
			},
		});
		const listDeviceListener = (deviceInfo) => socket.emit('list_devices', [parseDeviceData(deviceInfo)]);

		socket.on('list_devices', (data, callback) => {
			callback(null, this.getFoundDevices(true).map(parseDeviceData));
			this.on('found', listDeviceListener);
		});

		socket.on('disconnect', () => {
			this.removeListener('found', listDeviceListener);
			clearInterval(scanLockInterval);
		});
	}

	getPlaying(device, callback) {
		return callback(null, device.heosState['speaker_playing']);
	}

	setPlaying(device, value, callback) {

		device.instance.playerSetPlayState(device.groupId || device.playerId, ( value ) ? 'play' : 'pause', (err) => {
			if (err) return callback(err);

			device.heosState['speaker_playing'] = value;
			return callback(null, device.heosState['speaker_playing']);
		});

		// update others in group as well
		if (device.groupId) {
			for (let deviceId in this._devices) {
				let device_ = this._devices[deviceId];
				if (device_.groupId === device.groupId) {
					device_.heosState['speaker_playing'] = value;
					this.realtime(device_.deviceData, 'speaker_playing', value);
				}
			}
		}
	}

	play(device, callback) {
		this.setPlaying(device, true, callback);
	}

	pause(device, callback) {
		this.setPlaying(device, false, callback);
	}

	previous(device, callback) {
		device.instance.playerPlayPrevious(device.groupId || device.playerId, (err) => {
			if (err) return callback(err);
			return callback();
		});
	}

	next(device, callback) {
		device.instance.playerPlayNext(device.groupId || device.playerId, (err) => {
			if (err) return callback(err);
			return callback();
		});
	}

	getVolume(device, callback) {
		return callback(null, device.heosState['volume_set']);
	}

	setVolume(device, value, callback) {
		device.instance.playerSetVolume(device.playerId, value * 100, (err) => {
			if (err) return callback(err);

			device.heosState['volume_set'] = value;
			return callback(null, device.heosState['volume_set']);
		});
	}

	getMute(device, callback) {
		device.client.getMute((err, result) => {
			callback(err, Boolean(Number(result)));
		});
	}

	setMute(device, mute, callback) {
		device.client.setMute(mute ? '1' : '0', (err) => {
			callback(err, mute);
		});
	}

	foundDevice(deviceInfo) {
		if (deviceInfo.description.manufacturer !== 'Denon') {
			return;
		}
		super.foundDevice(deviceInfo);
	}
}

module.exports = Driver;