'use strict';

const events	= require('events');

const Discover 	= require('denon-heos').Discover;
const DenonHeos = require('denon-heos').DenonHeos;

class Driver extends events.EventEmitter {

	constructor() {
		super();

		this._devices = {};
		this._foundDevices = {};

		this.init = this._onInit.bind(this);
		this.pair = this._onPair.bind(this);

		this.capabilities = {};
		this.capabilities.speaker_playing = {};
		this.capabilities.speaker_playing.get = this._onCapabilitiesSpeakerPlayingGet.bind(this);
		this.capabilities.speaker_playing.set = this._onCapabilitiesSpeakerPlayingSet.bind(this);

		this.capabilities.speaker_prev = {};
		this.capabilities.speaker_prev.set = this._onCapabilitiesSpeakerPrevSet.bind(this);

		this.capabilities.speaker_next = {};
		this.capabilities.speaker_next.set = this._onCapabilitiesSpeakerNextSet.bind(this);

		this.capabilities.volume_set = {};
		this.capabilities.volume_set.get = this._onCapabilitiesVolumeSetGet.bind(this);
		this.capabilities.volume_set.set = this._onCapabilitiesVolumeSetSet.bind(this);

		Homey.manager('flow')
			.on('action.play', this._onFlowActionPlay.bind(this))
			.on('action.pause', this._onFlowActionPause.bind(this))
			.on('action.prev', this._onFlowActionPrev.bind(this))
			.on('action.next', this._onFlowActionNext.bind(this))
			.on('action.volume_set', this._onFlowActionVolumeSet.bind(this))

		Homey.on('unload', () => {
			this.log('Disconnecting all players...');
			for( let deviceId in this._devices ) {
				let device = this._devices[ deviceId ];
				if( device.instance.disconnect ) {
					device.instance.disconnect();
				}
			}
		})

	}

	log() {
		console.log.bind( null, `[log][DenonHeos]` ).apply( null, arguments );
	}

	_initDevice( device_data ) {

		this.setUnavailable( device_data, __('not_connected') );

		let foundDevice = this._foundDevices[ device_data.id ];
		if( foundDevice ) {
			let device = this._devices[ device_data.id ] = {
				data		: device_data,
				instance	: new DenonHeos( foundDevice.address ),
				state		: {
					speaker_playing	: false,
					volume_set		: 1
				},
				playerId	: undefined,
				groupId		: undefined
			}

			device.instance.connect( err => {
				if( err ) return this.setUnavailable( device_data, err );

				device.instance.playerGetPlayers(( err, players ) => {
					if( err ) return this.setUnavailable( device_data, err );

					// find playerId by IP
					if( !Array.isArray(players.payload) ) return;

					players.payload.forEach( player => {
						if( player.ip === foundDevice.address ) {
							device.playerId = player.pid.toString();
							device.groupId = ( player.gid ) ? player.gid.toString() : false;
						}
					});

					if( !device.playerId ) return;

					this.setAvailable( device_data );

					// get volume
					device.instance.playerGetVolume( device.playerId, ( err, result ) => {
						if( err ) return console.error( err );

						let volume = result.message.level / 100;

						device.state['volume_set'] = volume;
						this.realtime( device_data, 'volume_set', volume );
					});

					// on volume
					device.instance.on('player_volume_changed', ( message ) => {
						if( message.pid !== device.playerId ) return;

						let volume = ( parseInt(message.level) / 100 );
						if( volume !== device.state['volume_set'] ) {
							device.state['volume_set'] = volume;
							this.realtime( device_data, 'volume_set', volume );
						}

					});

					// get state
					device.instance.playerGetPlayState( device.playerId, ( err, result ) => {
						if( err ) return console.error( err );

						let speaker_playing = result.message.state === 'play';

						device.state['speaker_playing'] = speaker_playing;
						this.realtime( device_data, 'speaker_playing', speaker_playing );
					});

					// on state
					device.instance.on('player_state_changed', ( message ) => {
						if( message.pid !== device.playerId
						 && message.pid !== device.groupId ) return;

						let speaker_playing = ( message.state === 'play' );
						if( speaker_playing !== device.state['speaker_playing'] ) {
							device.state['speaker_playing'] = speaker_playing;
							this.realtime( device_data, 'speaker_playing', speaker_playing );
						}

						// update others in group as well
						if( device.groupId ) {
							for( let deviceId in this._devices ) {
								let device_ = this._devices[ deviceId ];
								if( device_.groupId === device.groupId ) {
									device_.state['speaker_playing'] = speaker_playing;
									this.realtime( device_.data, 'speaker_playing', speaker_playing );
								}
							}
						}
					});

					device.instance.on('groups_changed', ( message ) => {
						device.instance.playerGetPlayerInfo( device.playerId, ( err, player ) => {
							if( err ) return console.error( err );
							if( !player.payload ) return;

							device.groupId = ( player.payload.gid ) ? player.payload.gid.toString() : false;

							this.log('Player', device.playerId, 'is now in group', device.groupId);
						});
					});

				});

			});

		} else {
			this.once(`device:${device_data.id}`, () => {
				this._initDevice( device_data );
			})
		}

	}

	_uninitDevice( device_data ) {

	}

	_getDevice( device_data ) {
		return this._devices[ device_data.id ] || new Error('invalid_device');
	}

	/*
		Exports
	*/

	_onInit( devices_data, callback ) {

		devices_data.forEach(device_data => {
			this._initDevice( device_data );
		});

		callback();

		this._discover = new Discover();
		this._discover.start();
		this._discover.on('device', device => {
			this.log( `Found device`, device.friendlyName );
			this._foundDevices[ device.wlanMac ] = device;
			this.emit(`device:${device.wlanMac}`)
		});

	}

	_onPair( socket ) {

		socket.on('list_devices', ( data, callback ) => {

			let devices = [];

			for( let id in this._foundDevices ) {
				let foundDevice = this._foundDevices[ id ];

				devices.push({
					name: foundDevice.friendlyName,
					data: {
						id: id
					}
				})
			}

			callback( null, devices );

		});

	}

	_onCapabilitiesSpeakerPlayingGet( device_data, callback ) {

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		return callback( null, device.state['speaker_playing'] );

	}

	_onCapabilitiesSpeakerPlayingSet( device_data, value, callback ) {

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		device.instance.playerSetPlayState( device.groupId || device.playerId, ( value ) ? 'play' : 'pause', ( err ) => {
			if( err ) return callback( err );

			device.state['speaker_playing'] = value;
			return callback( null, device.state['speaker_playing'] );
		});

		// update others in group as well
		if( device.groupId ) {
			for( let deviceId in this._devices ) {
				let device_ = this._devices[ deviceId ];
				if( device_.groupId === device.groupId ) {
					device_.state['speaker_playing'] = value;
					this.realtime( device_.data, 'speaker_playing', value );
				}
			}
		}

	}

	_onCapabilitiesSpeakerPrevSet( device_data, value, callback ) {

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		device.instance.playerPlayPrevious( device.groupId || device.playerId, ( err ) => {
			if( err ) return callback( err );
			return callback();
		});

	}

	_onCapabilitiesSpeakerNextSet( device_data, value, callback ) {

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		device.instance.playerPlayNext( device.groupId || device.playerId, ( err ) => {
			if( err ) return callback( err );
			return callback();
		});

	}

	_onCapabilitiesVolumeSetGet( device_data, callback ) {

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		return callback( null, device.state['speaker_playing'] );

	}

	_onCapabilitiesVolumeSetSet( device_data, value, callback ) {

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		device.instance.playerSetVolume( device.playerId, value * 100, ( err ) => {
			if( err ) return callback( err );

			device.state['volume_set'] = value;
			return callback( null, device.state['speaker_playing'] );
		});

	}

	/*
		Flow
	*/
	_onFlowActionPlay( callback, args ) {
		this._onCapabilitiesSpeakerPlayingSet( args.device, true, callback );
	}

	_onFlowActionPause( callback, args ) {
		this._onCapabilitiesSpeakerPlayingSet( args.device, false, callback );
	}

	_onFlowActionPrev( callback, args ) {
		this._onCapabilitiesSpeakerPrevSet( args.device, true, callback );
	}

	_onFlowActionNext( callback, args ) {
		this._onCapabilitiesSpeakerNextSet( args.device, true, callback );
	}

	_onFlowActionVolumeSet( callback, args ) {
		this._onCapabilitiesVolumeSetSet( args.device, args.volume, callback );
	}

}

module.exports = Driver;