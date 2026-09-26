import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source-options';
loadEnv();

export default buildDataSourceOptions(process.env.DATABASE_URL).then(
  (options) => new DataSource(options),
);
