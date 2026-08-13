/** Minimal WebUSB types for public collect (Chrome / Edge). */
interface USBDeviceFilter {
  classCode?: number;
  subclassCode?: number;
  protocolCode?: number;
}

interface USB {
  requestDevice(options: { filters: USBDeviceFilter[] }): Promise<USBDevice>;
}

interface USBDevice {
  readonly productName?: string;
  readonly manufacturerName?: string;
  readonly serialNumber?: string;
}

interface Navigator {
  readonly usb?: USB;
}
