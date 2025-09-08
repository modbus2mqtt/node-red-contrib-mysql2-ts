module.exports = (RED) => {
  'use strict';

  // Note: we don't use mysql2/promise because it doesn't catch timeout error and lead to an "Uncaught Exception".
  // A patch has been developed but not published yet: https://github.com/sidorares/node-mysql2/pull/950
  const mysql = require('mysql2');

  function MySQLNode(config) {
    RED.nodes.createNode(this, config);

    this.query = (...args) => new Promise((resolve, reject) => {
      this.pool.query(...args, (err, ...results) => err ? reject(err) : resolve(results));
      this.pingReset(5);
    });

    this.pingReset = (timeout = 30) => {
      if (this.pingTimeout) {
        clearTimeout(this.pingTimeout);
      }
      this.pingTimeout = setTimeout(this.ping, timeout * 1000);
    };

    this.ping = async () => {
      try {
        await this.query('SELECT version();');
        this.emit('state', 'connected');
        this.pingReset();
      }
      catch (error) {
        this.emit('state', 'error',  error.toString());
        this.pingReset(5);
      }
    };

    this.connect = async () => {
      this.emit('state', 'connecting');

      if (this.pool) {
        return;
      }

      // Note: the connection is not done here
      this.pool = mysql.createPool({
        host: config.host,
        port: config.port,
        user: this.credentials.user,
        password: this.credentials.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        connectTimeout: 1000,
        ssl: config.tls ? {} : false,

        // See https://www.npmjs.com/package/mysql#custom-format
        queryFormat: (query, values) => {
          if (!values) return query;
          return query.replace(/:(\w+)/g, (txt, key) => {
            return Object.prototype.hasOwnProperty.call(values, key)
              ? this.pool.escape(values[key])
              : txt;
          });
        }
      });

      // Do a ping that will trigger the connection and check that it is working
      await this.ping();
    };

    this.on('close', async done => {
      if (this.pingTimeout) {
        clearTimeout(this.pingTimeout);
      }

      if (this.pool) {
        await this.pool.end();
      }

      this.emit('state');
      done();
    });
  }
  RED.nodes.registerType(
    'Stackhero-MySQL-Server',
    MySQLNode,
    {
      credentials: {
        user: { type: 'text' },
        password: { type: 'password' }
      }
    }
  );

  

  function MysqlDBNodeIn(config) {
    RED.nodes.createNode(this, config);
    this.serverConfig = RED.nodes.getNode(config.server);

    if (!this.serverConfig) {
      this.error('MySQL database not configured');
      return;
    }

    this.setState = (code, info) => {
      if (code === 'connecting') {
        this.status({ fill: 'grey', shape: 'ring', text: 'connecting...' });
      }
      else if (code === 'connected') {
        this.status({ fill: 'green', shape: 'dot', text: 'connected' });
      }
      else if (code === 'error') {
        this.status({ fill: 'red', shape: 'ring', text: info });
      }
      else if (code === 'queryDone') {
        this.status({ fill: 'blue', shape: 'dot', text: 'query done' });
      }
      else if (code === 'singleQueryDone') {
        this.status({ fill: 'blue', shape: 'dot', text: 'single query done' });
      }{
        this.status({});
      }
    };

    this.serverConfig.on('state', (code, info) => this.setState(code, info));

    this.on('input', async msg => {
      if (typeof(msg.topic) !== 'string' || !msg.topic) {
        this.error('msg.topic should be a string containing the SQL query.');
        return;
      }

      const isAnObject = (value) => value === Object(value);
      if (msg.payload !== undefined && !isAnObject(msg.payload)) {
        this.error(
          "msg.payload should be an object or an array containing the query arguments."
        );
        return;
      }
      if ((msg.payload != undefined ))
        if( !Array.isArray(msg.payload)){
        try {
          const [ result ] = await this.serverConfig
            .query(
              msg.topic,
              msg.payload
            );
          this.setState('singleQueryDone');
          msg.payload = result;
          this.send(msg);
        }
        catch (error) {
          this.error(error, msg);
          this.setState('error', error.toString());
        }
      }
      else 
        processArray(msg, this);
      else{
          //this.error(error, "No payload passed");
          this.setState('error', "Error no payload");
        }
    });

    this.on('close', async () => {  
      this.serverConfig.removeAllListeners();
      this.setState();
    });

    this.serverConfig.connect();
  }
  function processArray( msg,thisNode){
     let values = [];
     values =msg.payload;
      thisNode.serverConfig.pool.getConnection(function (err, connection) {
          if (err) {
              if(connection)
                connection.rollback(function () {
                  connection.release();
                });
              return
          }
          connection.beginTransaction(function (err) {
            let promisses = [];
            msg.payload = values.forEach((value) => {
              promisses.push(
                new Promise(function (resolve, reject) {
                  connection.query(
                    msg.topic,
                    value,
                      
                    function (error, results, _fields) {
                      if (error)
                        reject( error)
                      else resolve(results);
                    }
                  );
                })
              );
            });
            Promise.all(promisses).then((results) => {
             connection
                .commit(function (error) {
                  if (error) {
                    connection.rollback(function () {
                      connection.release();
                      //Failure
                      thisNode.error(error);
                      thisNode.setState("error", error.toString());
                    });
                  } else {
                    connection.commit();
                    connection.release();
                    msg.payload = results;
                    thisNode.setState("queryDone");
                    thisNode.send(msg);
                  }
                })
              
            }).catch((error) => {
              connection.rollback(function () {
                connection.release();
              });
              thisNode.error(error);
              thisNode.setState("error", error.toString());
            });;
          });
      });
  }
  RED.nodes.registerType('Stackhero-MySQL', MysqlDBNodeIn);
};
