// Storage interface placeholder
export interface Storage {
  read(_url: string): Promise<ArrayBuffer>
  exists(_url: string): Promise<boolean>
}