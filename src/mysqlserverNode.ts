import mysql,{Pool} from 'mysql2/promise';
import { Node, NodeAPI,NodeDef} from "node-red";

 interface MySQLServerNodeOptions {
    host: string;
    port: number;
    database: string;
    tls: boolean;
  } 
 export interface IstateMonitor{
  setState(code:string, info?:string):void;
  resetState():void;
}
 export interface MySQLServerNodeDef extends NodeDef, MySQLServerNodeOptions {}
 interface MySQLServerNodeCredentials { user: string; password: string; }
 export class MySQLServerNode  {
   pool: Pool|null = null ;
   pingTimeout: NodeJS.Timeout|null = null;
   credentials: { user: string; password: string; } = { user: '', password: '' };
   stateMonitors: IstateMonitor[] = [] ;

    query(sql: string, values?: any):Promise<any>{
        if( this.pool)
          return this.pool.query(sql, values);
        throw new Error('Not connected'); 
    };
    pingReset(timeout?: number):void{
      if (this.pingTimeout) {
        clearTimeout(this.pingTimeout);
      }
      if(timeout!= undefined)
        this.pingTimeout = setTimeout(this.ping.bind(this), timeout * 1000);
    };
    addStateMonitor(monitor:IstateMonitor):void{
      this.stateMonitors.push( monitor);
    }
    removeStateMonitor(monitor:IstateMonitor):void{
      const index = this.stateMonitors.indexOf(monitor);
      if (index > -1) {
        this.stateMonitors.splice(index, 1);
      }
    }
    setState(code:string, info?:string):void {
      this.stateMonitors.forEach( monitor => {
        monitor.setState(code, info);
      });
    }; 
    resetState():void {
      this.stateMonitors.forEach( monitor => {
        monitor.resetState();
      });
    }
    ping():Promise<void>{
        return  new Promise( (resolve, reject) => {
        this.query('SELECT version();').then( values => {
          this.setState( 'connected');
          this.pingReset(); 
            resolve();
        }).catch( error => {
          this.setState( 'error',  error.toString());
          this.pingReset(5);
        });
        });
    };

  connect():Promise<void> {
    return new Promise( (resolve, reject) => {
      this.setState('state', 'connecting');

      if (this.pool) {
        resolve();
      }

      // Note: the connection is not done here
      this.pool = mysql.createPool({
        host: this.config.host,
        port: this.config.port,
        user: this.credentials.user,
        password: this.credentials.password,
        database: this.config.database,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        connectTimeout: 1000,
        
        ssl: this.config.tls ? {} : undefined,

        // See https://www.npmjs.com/package/mysql#custom-format
        queryFormat: (query, values) => {
          if (!values) return query;
          return query.replace(/:(\w+)/g, (txt, key) => {
            return Object.prototype.hasOwnProperty.call(values, key)
              ? mysql.escape(values[key])
              : txt;
          });
        }
      })

      // Do a ping that will trigger the connection and check that it is working
    return this.ping();
    })
    
}
   constructor(private node:Node,private config:MySQLServerNodeDef) {
        (node as any).mySQLServerNode = this;
    }
   init():void{   
        this.credentials = this.red().credentials;
        this.red().log('Constructor called');
        this.red().on('close',  (done:()=>void) => {
                if (this.pingTimeout) {
                    clearTimeout(this.pingTimeout);
                }
        if (this.pool) {
                this.pool.end().finally( () => {
                    this.pool = null;
                    this.red().emit('state');
                    done();
                });
            }
        });
    }

    red():Node<MySQLServerNodeCredentials>{
        return this.node as unknown as Node<MySQLServerNodeCredentials>;
    }
}

export default function(RED:NodeAPI){

  function mySQLServerNodeCreate(this:Node<MySQLServerNodeCredentials>, config:MySQLServerNodeDef) {
    let thisNode:MySQLServerNode= new MySQLServerNode(this,config)
    RED.nodes.createNode(this, config);
 
    thisNode.init()
  }
  RED.nodes.registerType(
        'MySQL-Server',
        mySQLServerNodeCreate,
  {
      credentials: {
        user: { type: 'text' },
        password: { type: 'password' }
      }
  });
}

  