import type { API, Characteristic, CharacteristicSetCallback, CharacteristicValue, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import axios from 'axios';

import { DuetPlatformAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

// This is only required when using Custom Services and Characteristics not support by HomeKit
import { EveHomeKitTypes } from 'homebridge-lib/EveHomeKitTypes';

export class DuetHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  public readonly CustomServices: any;
  public readonly CustomCharacteristics: any;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.CustomServices = new EveHomeKitTypes(this.api).Services;
    this.CustomCharacteristics = new EveHomeKitTypes(this.api).Characteristics;

    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    this.accessories.set(accessory.UUID, accessory);

    const statusService = accessory.getService('Printer Status') || accessory.addService(this.Service.ContactSensor, 'Printer Status', 'printer-status');
    statusService.getCharacteristic(this.Characteristic.ContactSensorState)
      .on('get', async (callback: any) => {
        try {
          this.log.info('Fetching printer status...');
          const status = await this.getPrinterStatus();
          this.log.info('Printer status fetched:', status);
          const isOnline = status.someCondition; // Ajustează în funcție de răspunsul imprimantei
          const state = isOnline ? this.Characteristic.ContactSensorState.CONTACT_DETECTED : this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
          callback(null, state);
        } catch (error) {
          this.log.error('Error fetching printer status:', error);
          callback(error as Error);
        }
      });

    const temperatureService = accessory.getService('Temperature') || accessory.addService(this.Service.TemperatureSensor, 'Temperature', 'temperature');
    temperatureService.getCharacteristic(this.Characteristic.CurrentTemperature)
      .on('get', async (callback: any) => {
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

    const bedTemperatureService = accessory.getService('Bed Temperature') || accessory.addService(this.Service.TemperatureSensor, 'Bed Temperature', 'bed-temperature');
    bedTemperatureService.getCharacteristic(this.Characteristic.CurrentTemperature)
      .on('get', async (callback) => {
        try {
          this.log.info('Fetching bed temperature...');
          const temperatures = await this.getTemperatures();
          this.log.info('Bed temperature fetched:', temperatures.bed);
          callback(null, temperatures.bed);
        } catch (error) {
          this.log.error('Error fetching bed temperature:', error);
          callback(error as Error);
        }
      });

    const progressService = accessory.getService('Print Progress') || accessory.addService(this.Service.OccupancySensor, 'Print Progress', 'print-progress');
    progressService.getCharacteristic(this.Characteristic.OccupancyDetected)
      .on('get', async (callback) => {
        try {
          this.log.info('Fetching print progress...');
          const progress = await this.getPrintProgress();
          this.log.info('Print progress fetched:', progress);
          callback(null, progress);
        } catch (error) {
          this.log.error('Error fetching print progress:', error);
          callback(error as Error);
        }
      });

    const pauseService = accessory.getService('Pause Print') || accessory.addService(this.Service.Switch, 'Pause Print', 'pause-print');
    pauseService.getCharacteristic(this.Characteristic.On)
      .on('set', async (value, callback) => {
        try {
          if (value) {
            this.log.info('Pausing print...');
            await this.pausePrint();
            this.log.info('Print paused');
          }
          callback();
        } catch (error) {
          this.log.error('Error pausing print:', error);
          callback(error as Error);
        }
      });

    const cancelService = accessory.getService('Cancel Print') || accessory.addService(this.Service.Switch, 'Cancel Print', 'cancel-print');
    cancelService.getCharacteristic(this.Characteristic.On)
      .on('set', async (value, callback) => {
        try {
          if (value) {
            this.log.info('Stopping print...');
            await this.stopPrint();
            this.log.info('Print stopped');
          }
          callback();
        } catch (error) {
          this.log.error('Error stopping print:', error);
          callback(error as Error);
        }
      });
  }

  discoverDevices() {
    const devices = [
      {
        uniqueId: 'duet3d-extruder-temperature',
        displayName: 'Extruder Temperature',
        serviceType: this.Service.TemperatureSensor,
        characteristicType: this.Characteristic.CurrentTemperature,
        getValue: async () => {
          const temperatures = await this.getTemperatures();
          return temperatures.extruder;
        },
      },
      {
        uniqueId: 'duet3d-bed-temperature',
        displayName: 'Bed Temperature',
        serviceType: this.Service.TemperatureSensor,
        characteristicType: this.Characteristic.CurrentTemperature,
        getValue: async () => {
          const temperatures = await this.getTemperatures();
          return temperatures.bed;
        },
      },
      {
        uniqueId: 'duet3d-printer-progress',
        displayName: 'Print Progress',
        serviceType: this.Service.OccupancySensor,
        characteristicType: this.Characteristic.OccupancyDetected,
        getValue: async () => {
          const progress = await this.getPrintProgress();
          return progress;
        },
      },
      {
        uniqueId: 'duet3d-pause-print',
        displayName: 'Pause Print',
        serviceType: this.Service.Switch,
        characteristicType: this.Characteristic.On,
        setValue: async (value: CharacteristicValue) => {
          if (value) {
            await this.pausePrint();
          }
        },
      },
      {
        uniqueId: 'duet3d-cancel-print',
        displayName: 'Cancel Print',
        serviceType: this.Service.Switch,
        characteristicType: this.Characteristic.On,
        setValue: async (value: CharacteristicValue) => {
          if (value) {
            await this.stopPrint();
          }
        },
      },
    ];
  
    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(device.uniqueId);
      const accessory = new this.api.platformAccessory(device.displayName, uuid);
      accessory.context.device = device;
  
      const service = accessory.addService(device.serviceType, device.displayName, device.uniqueId);
      
      if (device.getValue) {
        service.getCharacteristic(device.characteristicType)
          .on('get', async (callback: any) => {
            try {
              const value = await device.getValue();
              callback(null, value);
            } catch (error) {
              this.log.error(`Error fetching ${device.displayName}:`, error);
              callback(error as Error);
            }
          });
      }
  
      if (device.setValue) {
        service.getCharacteristic(device.characteristicType)
          .on('set', async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            try {
              await device.setValue(value);
              callback();
            } catch (error) {
              this.log.error(`Error setting ${device.displayName}:`, error);
              callback(error as Error);
            }
          });
      }
  
      this.api.registerPlatformAccessories('homebridge-duet3d', 'DuetHomebridgePlatform', [accessory]);
      this.accessories.set(uuid, accessory);
  
      // Set interval to update printer status every 10 seconds
      setInterval(async () => {
        try {
          const status = await this.getPrinterStatus();
          const isOnline = status.someCondition; // Ajustează în funcție de răspunsul imprimantei
          const state = isOnline ? this.Characteristic.ContactSensorState.CONTACT_DETECTED : this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
          service.getCharacteristic(this.Characteristic.ContactSensorState).updateValue(state);
  
          const temperatures = await this.getTemperatures();
          accessory.getService('Extruder Temperature')?.getCharacteristic(this.Characteristic.CurrentTemperature).updateValue(temperatures.extruder);
          accessory.getService('Bed Temperature')?.getCharacteristic(this.Characteristic.CurrentTemperature).updateValue(temperatures.bed);
  
          const progress = await this.getPrintProgress();
          accessory.getService('Print Progress')?.getCharacteristic(this.Characteristic.OccupancyDetected).updateValue(progress);
        } catch (error) {
          this.log.error('Error updating printer status:', error);
        }
      }, 10000); // 10 secunde
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
          extruder: response.data.temps.current[1],
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