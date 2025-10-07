import mysql,{FieldPacket, OkPacket, Pool, ResultSetHeader, RowDataPacket} from 'mysql2/promise';
import { Node, NodeAPI,NodeDef} from "node-red";
import { IstateMonitor, MySQLServerNode, MySQLServerNodeDef } from './mysqlserverNode';

 interface MySQLQueryNodeOptions {
    host: string;
    port: number;
    database: string;
    tls: boolean;
    server:any;
} 
 interface MySQLQueryNodeDef extends NodeDef, MySQLQueryNodeOptions {}
 class MySQLQueryNode implements IstateMonitor{
    serverConfig: MySQLServerNode = undefined as unknown as MySQLServerNode;
      
    isAnObject(value:any):Boolean  {
        return value && typeof value === 'object' && value.constructor === Object;  
    };
    isAnArray(value:any):Boolean  {
        return Array.isArray(value);
    };
    setState(code:string, info?:string):void {
      if (code === 'connecting') {
        this.red().status({ fill: 'grey', shape: 'ring', text: 'connecting...' });
      }
      else if (code === 'connected') {
        this.red().status({ fill: 'green', shape: 'dot', text: 'connected' });
      }
      else if (code === 'error') {
        this.red().status({ fill: 'red', shape: 'ring', text: info });
      }
      else if (code === 'queryDone') {
        this.red().status({ fill: 'blue', shape: 'dot', text: 'query done' });
      }
      else if (code === 'singleQueryDone') {
        this.red().status({ fill: 'blue', shape: 'dot', text: 'single query done' });
      }
    }; 
  resetState():void {
      this.red().status({});
  }

  constructor(private node:Node,private config:MySQLQueryNodeDef){}
  init():void{    
        this.red().log('Constructor called');
        
        this.serverConfig?.setStateMonitor(this);
    
        this.red().on('input',  async ( msg:any) => {
      if (typeof(msg.topic) !== 'string' || !msg.topic) {
        this.red().error('msg.topic should be a string containing the SQL query.');
        return;
      }
     if (msg.payload !== undefined && !this.isAnObject(msg.payload)) {
        this.red().error(
          "msg.payload should be an object or an array containing the query arguments."
        );
        return false;
      }
      
      if ((msg.payload != undefined ))
        if( !Array.isArray(msg.payload)){
          this.serverConfig
            .query(
              msg.topic,
              msg.payload
            ).then( ([result, fields]) => {
              this.setState('singleQueryDone');
              msg.payload = result;
              this.red().send(msg);
            }).catch( error => {
              this.red().error(error, msg);
              this.setState('error', error.toString());
            });
      }
      else 
        this.processArray(msg);
      else{
          //this.error(error, "No payload passed");
          this.setState('error', "Error no payload");
        }
    });
    this.red().on('close', () => {  
      this.serverConfig.red().removeAllListeners();
      this.resetState();
    });

    this.serverConfig.connect().catch( error => {
        this.red().error(error);
        this.setState('error', error.toString());
    })

  }
    red():Node{
        return this.node as Node;
    }
    private processArray( msg:any):void{
     let values = [];
     values =msg.payload;
     if( !this.serverConfig || !this.serverConfig.pool){
        this.red().error("No database connection");
        this.setState('error', "No database connection");
        return;
     }
      this.serverConfig.pool.getConnection()
        .catch((err) => {
         let msg = "Error getting connection from pool: " + err;
         this.red().error(msg);
         this.setState('error', msg);
         return;
        }).then((connection) => {
          if(!connection){
            this.red().error("No connection available");
            this.setState('error', "No connection available");
            return;
          }
          connection.beginTransaction().then( ()=>{
            let promisses:Promise<[RowDataPacket[] | RowDataPacket[][] | OkPacket | OkPacket[] | ResultSetHeader, FieldPacket[]]>[] = [];
            msg.payload = values.forEach((value:any) => {
              promisses.push(
                  connection.query(
                    msg.topic,
                    value
              )
              );
            });
            Promise.all(promisses).then((results) => {
             connection.commit().then(() =>   {
                    connection.release();
                    msg.payload = results;
                    this.setState("queryDone");
                    this.red().send(msg);
                  })
                    .catch((error) => {     
                      connection.rollback().then(()=> {
                      connection.release();
                      //Failure
                      let msg = "Error committing transaction: " + error;
                      this.red().error(msg );
                      this.setState("error", msg);
                    });
                  })
                })
              .catch((error) => {
              connection.rollback() .then(()=>  {
                connection.release();
              //Failure
                let msg = "Error execute query: " + error;
                this.red().error(msg);
                this.setState("error", msg);
              });
          });
          }).catch((error) => {
            let msg = "Error: getConnection from pool" + error;
            //Failure
            this.red().error(msg);
            this.setState("error", msg);
          })
      });
  }
}

export = function(RED:NodeAPI){

  function MySQLQueryNodeCreate(this:Node, config:MySQLQueryNodeDef) {
    let thisNode:MySQLQueryNode= new MySQLQueryNode(this,config)
    RED.nodes.createNode(this, config);
    let server = RED.nodes.getNode(config.server);
    thisNode.serverConfig = (server as any).mySQLServerNode as MySQLServerNode;
    if(!thisNode.serverConfig){
      thisNode.red().error("No MySQL-Server configured");
      thisNode.red().log("No MySQL-Server configured");
      
      return;
    }
    thisNode.init()
  }
  RED.nodes.registerType(
        'MySQL-Query',
        MySQLQueryNodeCreate);
}
