import type { API, Characteristic, CharacteristicSetCallback, CharacteristicValue, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import axios from 'axios';

import { DuetPlatformAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

// This is only required when using Custom Services and Characteristics not support by HomeKit
import { EveHomeKitTypes } from 'homebridge-lib/EveHomeKitTypes';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class DuetHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  // This is only required when using Custom Services and Characteristics not support by HomeKit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomServices: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomCharacteristics: any;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // This is only required when using Custom Services and Characteristics not support by HomeKit
    this.CustomServices = new EveHomeKitTypes(this.api).Services;
    this.CustomCharacteristics = new EveHomeKitTypes(this.api).Characteristics;

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);

    const service = accessory.getService(this.Service.Switch) || accessory.addService(this.Service.Switch);

    service.getCharacteristic(this.Characteristic.On)
      .on('set', this.setPrinterStatus.bind(this));

      service.getCharacteristic(this.Characteristic.On)
      .on('get', async (callback) => {
        try {
          this.log.info('Fetching printer status...');
          const status = await this.getPrinterStatus();
          this.log.info('Printer status fetched:', status);
          const isPrinting = status.status === 'P';
          callback(null, isPrinting);
        } catch (error) {
          this.log.error('Error fetching printer status:', error);
          callback(error as Error);
        }
      });

    // service.getCharacteristic(this.Characteristic.On)
    //   .on('set', async (value, callback) => {
    //     try {
    //       if (value) {
    //         this.log.info('Pausing print...');
    //         await this.pausePrint();
    //         this.log.info('Print paused');
    //       } else {
    //         this.log.info('Stopping print...');
    //         await this.stopPrint();
    //         this.log.info('Print stopped');
    //       }
    //       callback();
    //     } catch (error) {
    //       this.log.error('Error setting print status:', error);
    //       callback(error as Error);
    //     }
    //   });

    const temperatureService = accessory.getService('Temperature') || accessory.addService(this.Service.TemperatureSensor, 'Temperature');

    temperatureService.getCharacteristic(this.Characteristic.CurrentTemperature)
      .on('get', async (callback) => {
        try {
          this.log.info('Fetching temperatures...');
          const temperatures = await this.getTemperatures();
          this.log.info('Temperatures fetched:', temperatures);
          callback(null, temperatures.extruder);
        } catch (error) {
          this.log.error('Error fetching temperatures:', error);
          callback(error as Error);
        }
      });

    // const bedTemperatureService = accessory.getService('Bed Temperature') || accessory.addService(this.Service.TemperatureSensor, 'Bed Temperature');

    // bedTemperatureService.getCharacteristic(this.Characteristic.CurrentTemperature)
    //   .on('get', async (callback) => {
    //     try {
    //       this.log.info('Fetching bed temperature...');
    //       const temperatures = await this.getTemperatures();
    //       this.log.info('Bed temperature fetched:', temperatures.bed);
    //       callback(null, temperatures.bed);
    //     } catch (error) {
    //       this.log.error('Error fetching bed temperature:', error);
    //       callback(error as Error);
    //     }
    //   });

    // const progressService = accessory.getService('Print Progress') || accessory.addService(this.Service.OccupancySensor, 'Print Progress');

    // progressService.getCharacteristic(this.Characteristic.OccupancyDetected)
    //   .on('get', async (callback) => {
    //     try {
    //       this.log.info('Fetching print progress...');
    //       const progress = await this.getPrintProgress();
    //       this.log.info('Print progress fetched:', progress);
    //       callback(null, progress);
    //     } catch (error) {
    //       this.log.error('Error fetching print progress:', error);
    //       callback(error as Error);
    //     }
    //   });
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    const devices = [
      { uniqueId: 'duet3d-printer', displayName: '3D Printer' }
    ];

    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(device.uniqueId);
      const accessory = new this.api.platformAccessory(device.displayName, uuid);
      accessory.context.device = device;

      const service = accessory.addService(this.Service.Switch, device.displayName);
      service.getCharacteristic(this.Characteristic.On)
        .on('set', this.setPrinterStatus.bind(this));

      this.api.registerPlatformAccessories('homebridge-duet3d', 'DuetHomebridgePlatform', [accessory]);
      this.accessories.set(uuid, accessory);
    }
  }

  async setPrinterStatus(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    try {
      const command = value ? 'M25' : 'M0';
      await axios.get(`${this.config.ip}/rr_gcode?gcode=${command}`);
      callback();
    } catch (error: any) {
      this.log.error('Error setting printer status:', error);
      callback(error);
    }
  }

  async getPrinterStatus() {
    try {
      const response = await axios.get('http://192.168.1.146/rr_status?type=2');
      return response.data;
    } catch (error) {
      this.log.error('Error fetching printer status:', error);
      throw new Error('Failed to fetch printer status');
    }
  }

  async getTemperatures() {
    try {
      const response = await axios.get('http://192.168.1.146/rr_status?type=2');
      const temperatures = {
        extruder: response.data.temps.current[0],
        bed: response.data.temps.bed.current,
      };
      return temperatures;
    } catch (error) {
      this.log.error('Error fetching temperatures:', error);
      throw new Error('Failed to fetch temperatures');
    }
  }

  async getPrintProgress() {
    try {
      const response = await axios.get('http://192.168.1.146/rr_status?type=3');
      return response.data.progress;
    } catch (error) {
      this.log.error('Error fetching print progress:', error);
      throw new Error('Failed to fetch print progress');
    }
  }

  async pausePrint() {
    try {
      await axios.get('http://192.168.1.146/rr_gcode?gcode=M25');
    } catch (error) {
      this.log.error('Error pausing print:', error);
      throw new Error('Failed to pause print');
    }
  }

  async stopPrint() {
    try {
      await axios.get('http://192.168.1.146/rr_gcode?gcode=M0');
    } catch (error) {
      this.log.error('Error stopping print:', error);
      throw new Error('Failed to stop print');
    }
  }
}
