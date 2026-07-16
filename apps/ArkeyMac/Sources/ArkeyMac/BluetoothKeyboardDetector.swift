import Foundation
import IOKit.hid

enum BluetoothKeyboardDetector {
    static func isConnected(vendorId: Int, productIds: [Int]) -> Bool {
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        IOHIDManagerSetDeviceMatching(manager, [kIOHIDVendorIDKey: vendorId] as CFDictionary)
        guard IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone)) == kIOReturnSuccess,
              let deviceSet = IOHIDManagerCopyDevices(manager) else { return false }
        defer { IOHIDManagerClose(manager, IOOptionBits(kIOHIDOptionsTypeNone)) }

        for case let device as IOHIDDevice in deviceSet as NSSet {
            let productId = (IOHIDDeviceGetProperty(device, kIOHIDProductIDKey as CFString) as? NSNumber)?.intValue
            let transport = (IOHIDDeviceGetProperty(device, kIOHIDTransportKey as CFString) as? String)?.lowercased()
            let usagePage = (IOHIDDeviceGetProperty(device, kIOHIDPrimaryUsagePageKey as CFString) as? NSNumber)?.intValue
            let usage = (IOHIDDeviceGetProperty(device, kIOHIDPrimaryUsageKey as CFString) as? NSNumber)?.intValue
            if productId.map(productIds.contains) == true,
               transport?.contains("bluetooth") == true,
               usagePage == kHIDPage_GenericDesktop,
               usage == kHIDUsage_GD_Keyboard {
                return true
            }
        }
        return false
    }
}
