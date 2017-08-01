/* eslint-disable import/no-dynamic-require */
(function () {
  'use strict';

  angular.module('copayApp.services')
    .factory('fundingNodeService', ($q, $rootScope, discoveryService, correspondentListService) => {
      const self = {};

      let messageIntervalTimeout = 5 * 60 * 1000; // 5min
      let exchangeFee = 0.001;
      let fundingNode = false;

      let messageInterval = null;
      let assocBalances = null;

      self.update = update;
      self.isActivated = isActivated;
      self.getExchangeFee = getExchangeFee;
      self.setExchangeFee = setExchangeFee;
      self.canEnable = canEnable;
      self.deactivate = deactivate;
      self.activate = activate;
      self.init = init;

      $rootScope.$on('Local/ProfileBound', () => {
        self.init();
      });

      $rootScope.$on('Local/BalanceUpdated', (event, ab) => {
        assocBalances = ab;

        self.canEnable().then(
          () => {
          },
          () => {
            if (fundingNode) {
              self.update(false).then(
                () => {
                },
                (err) => {
                  console.log(err);
                }
              );
            }
          });
      });

      function init() {
        const conf = require('byteballcore/conf.js');

        exchangeFee = conf.exchangeFee || exchangeFee;
        messageIntervalTimeout = conf.fundingNodeMessageInterval || messageIntervalTimeout;

        discoveryService.sendMessage(discoveryService.messages.listTraders).then(() => {
        });
        return self.update(conf.fundingNode || false);
      }

      function requireUncached(module) {
        delete require.cache[require.resolve(module)];
        return require(module.toString());
      }

      function updateConfig() {
        const def = $q.defer();
        const fs = require('fs');
        const desktopApp = require('byteballcore/desktop_app.js');
        const appDataDir = desktopApp.getAppDataDir();
        const userConfFile = `${appDataDir}/conf.json`;
        const userConf = requireUncached(userConfFile);

        userConf.fundingNode = fundingNode;
        userConf.exchangeFee = exchangeFee;

        fs.writeFile(userConfFile, JSON.stringify(userConf, null, '\t'), 'utf8', (err) => {
          if (err) {
            def.reject(err);
          } else {
            def.resolve();
          }
        });

        return def.promise;
      }

      function setFundnigNode(val) {
        const def = $q.defer();

        fundingNode = val;

        updateConfig().then(() => {
          def.resolve();
        }, (err) => {
          def.reject(err);
        });

        return def.promise;
      }

      function isActivated() {
        return fundingNode;
      }

      function aliveAndWell() {
        const def = $q.defer();

        correspondentListService.startWaitingForPairing((pairingInfo) => {
          const code = `${pairingInfo.device_pubkey}@${pairingInfo.hub}#${pairingInfo.pairing_secret}`;

          discoveryService.sendMessage(discoveryService.messages.aliveAndWell, {pairCode: code}).then(() => {
            def.resolve();
          }, def.reject);
        });

        return def.promise;
      }

      function activate() {
        const def = $q.defer();

        if (fundingNode) {
          def.resolve();
        } else {
          discoveryService.sendMessage(discoveryService.messages.startingTheBusiness).then(() => {
            setExchangeFee(exchangeFee).then(() => {
              aliveAndWell().then(() => {
                messageInterval = setInterval(() => {
                  aliveAndWell().then(() => { },
                    (err) => {
                      console.log(err);
                    }
                  );
                }, messageIntervalTimeout);

                def.resolve();
              }, def.reject);
            }, def.reject);
          });
        }

        return def.promise;
      }

      function deactivate() {
        const def = $q.defer();

        if (fundingNode) {
          if (messageInterval) {
            clearInterval(messageInterval);
          }

          discoveryService.sendMessage(discoveryService.messages.outOfBusiness).then(def.resolve, def.reject);
        } else {
          def.resolve();
        }

        return def.promise;
      }

      function canEnable() {
        const d = $q.defer();

        function isLatestVersion() {
          const def = $q.defer();

          // todo funding node is stub
          def.resolve(true);

          return def.promise;
        }

        function hasBytes() {
          const def = $q.defer();

          if (assocBalances && assocBalances.base && parseInt(assocBalances.base.stable, 10) > 0) {
            def.resolve(true);
          } else {
            def.resolve(false);
          }

          return def.promise;
        }

        const isLatestVersionPromise = isLatestVersion();
        const hasBytesPromise = hasBytes();

        $q.all([isLatestVersionPromise, hasBytesPromise]).then((results) => {
          const successResults = results.filter(item => item);
          if (successResults.length !== results.length) {
            d.reject();
            return;
          }

          d.resolve();
        });

        return d.promise;
      }

      function getExchangeFee() {
        return exchangeFee;
      }

      function setExchangeFee(ef) {
        const def = $q.defer();

        discoveryService.sendMessage(discoveryService.messages.updateExchangeFee, {exchangeFee: ef}).then(() => {
          exchangeFee = ef;

          updateConfig().then(def.resolve, def.reject);
        }, def.reject);

        return def.promise;
      }

      function update(val) {
        const def = $q.defer();

        let func;

        if (val) {
          func = activate;
        } else {
          func = deactivate;
        }

        func().then(() => {
          setFundnigNode(val).then(def.resolve, def.reject);
        }, def.reject);

        return def.promise;
      }

      return self;
    });
}());
