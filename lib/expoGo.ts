import Constants, { ExecutionEnvironment } from 'expo-constants';

/** Expo Go lacks custom native modules such as expo-notifications' topic subscriptions. */
export const isExpoGo = (): boolean =>
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
