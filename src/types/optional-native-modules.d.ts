declare module 'expo-document-picker' {
  export type DocumentPickerAsset = {
    file?: File;
    mimeType?: string;
    name: string;
    size?: number;
    uri: string;
  };

  export type DocumentPickerResult =
    | { assets: null; canceled: true }
    | { assets: DocumentPickerAsset[]; canceled: false };

  export function getDocumentAsync(options?: {
    copyToCacheDirectory?: boolean;
    multiple?: boolean;
    type?: string | string[];
  }): Promise<DocumentPickerResult>;
}

declare module 'expo-sqlite' {
  export type SQLiteDatabase = {
    execAsync(sql: string): Promise<void>;
    getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
    runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
  };

  export function openDatabaseAsync(name: string): Promise<SQLiteDatabase>;
}

declare module '@react-native-community/datetimepicker' {
  import type { DateTimePickerEvent } from 'react-native';

  export type DateTimePickerProps = {
    value: Date;
    mode?: 'date' | 'time' | 'datetime';
    display?: 'default' | 'spinner' | 'calendar' | 'clock' | 'compact' | 'inline';
    minimumDate?: Date;
    onChange?: (event: DateTimePickerEvent, date?: Date) => void;
  };

  export default function DateTimePicker(props: DateTimePickerProps): React.ReactElement;
}
