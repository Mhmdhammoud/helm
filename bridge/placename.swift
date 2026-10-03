// placename <lat> <lon>: prints the city at those coordinates, using Apple's geocoder (no location permission needed).
import CoreLocation
import Foundation

let args = CommandLine.arguments
guard args.count == 3, let lat = Double(args[1]), let lon = Double(args[2]) else { exit(2) }
CLGeocoder().reverseGeocodeLocation(CLLocation(latitude: lat, longitude: lon)) { marks, _ in
  let m = marks?.first
  print(m?.locality ?? m?.subAdministrativeArea ?? m?.administrativeArea ?? "")
  exit(0)
}
DispatchQueue.main.asyncAfter(deadline: .now() + 8) { exit(1) }
dispatchMain()
