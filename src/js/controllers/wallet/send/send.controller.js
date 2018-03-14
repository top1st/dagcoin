/* eslint-disable radix,no-nested-ternary,no-shadow,no-plusplus,consistent-return,no-underscore-dangle,no-use-before-define,comma-dangle,no-undef */
(() => {
  'use strict';

  angular
    .module('copayApp.controllers')
    .controller('SendCtrl', SendCtrl);

  SendCtrl.$inject = ['$scope', '$rootScope', '$timeout', 'lodash', 'profileService',
    'configService', 'addressService', 'addressbookService', 'animationService', 'gettextCatalog',
    'utilityService', 'transactionsService', 'walletService', 'ENV', '$modal', '$state', '$stateParams'];

  function SendCtrl($scope, $rootScope, $timeout, lodash, profileService,
                    configService, addressService, addressbookService, animationService, gettextCatalog,
                    utilityService, transactionsService, walletService, ENV, $modal, $state, $stateParams) {
    const breadcrumbs = require('byteballcore/breadcrumbs.js');
    const eventBus = require('byteballcore/event_bus.js');

    // TODO indexScope is called just for getting available amount. This should not be done like that.
    const indexScope = $scope.index;
    const config = configService.getSync();
    const configWallet = config.wallet;
    const vm = this;

    // INIT
    const walletSettings = configWallet.settings;
    vm.unitValue = walletSettings.unitValue;
    vm.unitName = walletSettings.unitName;
    vm.unitDecimals = walletSettings.unitDecimals;
    vm.blockUx = false;
    vm.lockAddress = false;
    vm.lockAmount = false;

    const assocDeviceAddressesByPaymentAddress = {};

    $scope.currentSpendUnconfirmed = configWallet.spendUnconfirmed;

    /**
     * Runs when the view of controller is rendered
     * Make all initialization of controller in this method
     */
    const viewContentLoaded = function () {
      const request = lodash.assign(new PaymentRequest(), $stateParams);
      $scope.sendForm.$setPristine();
      if (profileService.focusedClient) {
        vm.setSendFormInputs();
      }
      if (request.isNotEmpty()) {
        const form = $scope.sendForm;
        console.log(`A payment requested. Form will be rendered with these values ${JSON.stringify(request)}`);
        if (PaymentRequest.PAYMENT_REQUEST === request.type) {
          vm.setForm(request.address, request.amount, request.comment, request.asset, request.recipientDeviceAddress);
          if (form.address.$invalid && !vm.blockUx) { // TODO sinan ?? blockUx
            console.log('Payment Request :: invalid address, resetting form');
            vm.resetForm();
            vm.error = gettextCatalog.getString('Could not recognize a valid Dagcoin QR Code');
          }
        } else if (PaymentRequest.MERCHANT_PAYMENT_REQUEST === request.type) {
          vm.invoiceId = invoiceId;
          vm.validForSeconds = Math.floor(vm.validForSeconds - 10); // 10 is a security threshold ?? TODO sinan
          if (request.state === 'PENDING') {
            vm.setForm(request.address, request.amount, null, ENV.DAGCOIN_ASSET, null);
            if (form.address.$invalid && !vm.blockUx) { // TODO sinan ?? blockUx
              console.log('Merchant Payment Request :: invalid address, resetting form');
              vm.resetForm();
              vm.error = gettextCatalog.getString('Could not recognize a valid Dagcoin QR Code');
            }

            if (vm.validForSeconds <= 0) { // TODO sinan bunları walletHome'dan sil
              vm.resetForm();
              vm.error = gettextCatalog.getString('Merchant payment request expired');
            }

            vm.countDown();
          } else {
            vm.resetForm();
            vm.error = walletService.getStateErrorMessageForMerchantPayment(state);
          }
        }
      }
    };

    const destroy = () => {
      console.log('send controller $destroy');
      $rootScope.hideMenuBar = false;
    };

    vm.countDown = function () {
      if (vm.validForSeconds == null) {
        // Form has been reset
        return;
      }

      if (vm.validForSeconds <= 0) {
        vm.resetForm();
        vm.error = gettextCatalog.getString('Payment request expired');
        return;
      }

      $timeout(() => {
        vm.validForSeconds -= 1;
        vm.countDown();
      }, 1000);
    };

    vm.resetError = function () {
      vm.error = null;
      vm.success = null;
    };

    vm.onAddressChange = function (value) {
      vm.resetError();
      return !value ? '' : value;
    };

    vm.setSendFormInputs = function () {
      /**
       * Setting the two related amounts as properties prevents an infinite
       * recursion for watches while preserving the original angular updates
       *
       */
      Object.defineProperty($scope,
        '_amount', {
          get() {
            return $scope.__amount;
          },
          set(newValue) {
            $scope.__amount = newValue;
            vm.resetError();
          },
          enumerable: true,
          configurable: true
        });

      Object.defineProperty($scope,
        '_address', {
          get() {
            return $scope.__address;
          },
          set(newValue) {
            $scope.__address = vm.onAddressChange(newValue);
          },
          enumerable: true,
          configurable: true,
        });

      // ToDo: use a credential's (or fc's) function for this
      vm.hideNote = true;
    };

    vm.setForm = function (to, amount, comment, asset, recipientDeviceAddress, isMerchant) {
      vm.resetError();
      delete vm.binding;
      const form = $scope.sendForm;
      let moneyAmount = amount;
      if (!form || !form.address) {
        // disappeared?
        return console.log('form.address has disappeared');
      }
      if (to) {
        form.address.$setViewValue(to);
        form.address.$isValid = true;
        form.address.$render();
        if (recipientDeviceAddress) {
          // must be already paired
          assocDeviceAddressesByPaymentAddress[to] = recipientDeviceAddress;
        }
      }

      vm.lockAddress = to && isMerchant;

      if (moneyAmount) {
        moneyAmount /= vm.unitValue;
        vm.lockAmount = true;
        $timeout(() => {
          form.amount.$setViewValue(`${moneyAmount}`);
          form.amount.$isValid = true;
          form.amount.$render();

          form.address.$setViewValue(to);
          form.address.$isValid = true;
          form.address.$render();
        }, 300);
      } else {
        vm.lockAmount = false;
        form.amount.$pristine = true;
        form.amount.$render();
      }

      if (form.merkle_proof) {
        form.merkle_proof.$setViewValue('');
        form.merkle_proof.$render();
      }
      if (comment) {
        form.comment.$setViewValue(comment);
        form.comment.$isValid = true;
        form.comment.$render();
      }

      if (asset) {
        const assetIndex = lodash.findIndex($scope.index.arrBalances, { asset });
        if (assetIndex < 0) {
          throw Error(gettextCatalog.getString(`failed to find asset index of asset ${asset}`));
        }
        $scope.index.assetIndex = assetIndex;
        vm.lockAsset = true;
      } else {
        vm.lockAsset = false;
      }
    };

    vm.resetForm = function (cb) {
      vm.resetError();
      delete vm.binding;

      const invoiceId = vm.invoiceId;

      const options = {
        uri: `${ENV.MERCHANT_INTEGRATION_API}/cancel`,
        method: 'POST',
        json: {
          invoiceId
        }
      };

      if (invoiceId !== null) {
        const request = require('request');
        request(options, (error, response, body) => {
          if (error) {
            console.log(`CANCEL ERROR: ${error}`);
          }
          console.log(`RESPONSE: ${JSON.stringify(response)}`);
          console.log(`BODY: ${JSON.stringify(body)}`);
        });
      }

      vm.invoiceId = null;
      vm.validForSeconds = null;
      vm.lockAsset = false;
      vm.lockAddress = false;
      vm.lockAmount = false;
      vm.hideAdvSend = true;

      vm._amount = null;
      vm._address = null;
      vm.bSendAll = false;

      const form = $scope.sendForm;

      if (form && form.amount) {
        form.amount.$pristine = true;
        form.amount.$setViewValue('');
        if (form.amount) {
          form.amount.$render();
        }

        if (form.merkle_proof) {
          form.merkle_proof.$setViewValue('');
          form.merkle_proof.$render();
        }
        if (form.comment) {
          form.comment.$setViewValue('');
          form.comment.$render();
        }
        form.$setPristine();

        if (form.address) {
          form.address.$pristine = true;
          form.address.$setViewValue('');
          form.address.$render();
        }
      }
      $timeout(() => {
        if (cb) {
          cb();
        }
        $rootScope.$digest();
      }, 1);
    };

    vm.setSendAll = () => {
      const form = $scope.sendForm;
      if (!form || !form.amount || indexScope.arrBalances.length === 0) {
        return;
      }
      let available = indexScope.baseBalance.stable;
      available /= vm.unitValue;
      form.amount.$setViewValue(`${available}`);
      form.amount.$render();
    };

    vm.openDestinationAddressModal = function (wallets, address) {
      $rootScope.modalOpened = true;
      const fc = profileService.focusedClient;

      const ModalInstanceCtrl = function ($scope, $modalInstance) {
        $scope.wallets = wallets;
        $scope.isMultiWallet = wallets.length > 0;
        $scope.selectedAddressbook = {};
        $scope.newAddress = address;
        $scope.addressbook = {
          address: ($scope.newAddress || ''),
          label: '',
        };
        $scope.color = fc.backgroundColor;
        $scope.bAllowAddressbook = vm.canSendExternalPayment();
        $scope.selectedWalletsOpt = !!(wallets[0] || !$scope.bAllowAddressbook);

        $scope.selectAddressbook = function (addr) {
          $modalInstance.close(addr);
        };

        $scope.setWalletsOpt = function () {
          $scope.selectedWalletsOpt = !$scope.selectedWalletsOpt;
        };

        $scope.listEntries = function () {
          $scope.error = null;
          addressbookService.list((ab) => {
            const sortedContactArray = lodash.sortBy(ab, (contact) => {
              const favoriteCharacter = contact.favorite === true ? '!' : '';
              const fullName = `${contact.first_name}${contact.last_name}`.toUpperCase();
              return `${favoriteCharacter}${fullName}`;
            });
            $scope.list = {};
            lodash.forEach(sortedContactArray, (contact) => {
              $scope.list[contact.address] = contact;
            });
          });
        };

        $scope.$watch('addressbook.label', (value) => {
          if (value && value.length > 16) {
            $scope.addressbook.label = value.substr(0, 16);
          }
        });

        $scope.cancel = function () {
          breadcrumbs.add('openDestinationAddressModal cancel');
          $modalInstance.dismiss('cancel');
        };

        $scope.selectWallet = function (walletId, walletName) {
          $scope.selectedWalletName = walletName;
          addressService.getAddress(walletId, false, (err, addr) => {
            $scope.gettingAddress = false;

            if (err) {
              vm.error = err;
              breadcrumbs.add(`openDestinationAddressModal getAddress err: ${err}`);
              $modalInstance.dismiss('cancel');
              return;
            }

            $modalInstance.close(addr);
          });
        };
      };

      const modalInstance = $modal.open({
        templateUrl: 'views/modals/destination-address.html',
        windowClass: animationService.modalAnimated.slideUp,
        controller: ModalInstanceCtrl,
      });

      const disableCloseModal = $rootScope.$on('closeModal', () => {
        breadcrumbs.add('openDestinationAddressModal on closeModal');
        modalInstance.dismiss('cancel');
      });

      modalInstance.result.finally(() => {
        $rootScope.modalOpened = false;
        disableCloseModal();
        const m = angular.element(document.getElementsByClassName('reveal-modal'));
        m.addClass(animationService.modalAnimated.slideOutDown);
      });

      modalInstance.result.then((addr) => {
        if (addr) {
          vm.setToAddress(addr);
        }
      });
    };

    vm.canSendExternalPayment = function () {
      if ($scope.index.arrBalances.length === 0) {
        // no balances yet, assume can send
        return true;
      }
      if (!$scope.index.arrBalances[$scope.index.assetIndex].is_private) {
        return true;
      }
      const form = $scope.sendForm;
      if (!form || !form.address) {
        // disappeared
        return true;
      }
      const address = form.address.$modelValue;
      const recipientDeviceAddress = assocDeviceAddressesByPaymentAddress[address];
      return !!recipientDeviceAddress;
    };

    vm.deviceAddressIsKnown = function () {
      if ($scope.index.arrBalances.length === 0) {
        // no balances yet
        return false;
      }
      const form = $scope.sendForm;
      if (!form || !form.address) {
        // disappeared
        return false;
      }
      const address = form.address.$modelValue;
      const recipientDeviceAddress = assocDeviceAddressesByPaymentAddress[address];
      return !!recipientDeviceAddress;
    };

    vm.setToAddress = function (to) {
      const form = $scope.sendForm;
      if (!form || !form.address) {
        // disappeared?
        return console.log('form.address has disappeared');
      }
      form.address.$setViewValue(to);
      form.address.$isValid = true;
      form.address.$render();
    };

    vm.setSendError = function (err) {
      const fc = profileService.focusedClient;
      const prefix = fc.credentials.m > 1 ?
        gettextCatalog.getString('Could not create payment proposal') :
        gettextCatalog.getString('Could not send payment');

      vm.error = `${prefix}: ${err}`;
      console.log(vm.error);

      $timeout(() => {
        $scope.$digest();
      }, 1);
    };

    /**
     * Invoked when SEND button clicked
     * @return {*}
     */
    vm.submitForm = function () {
      if ($scope.index.arrBalances.length === 0) {
        vm.setSendError(gettextCatalog('no balances yet'));
        return console.log('send payment: no balances yet');
      }
      const fc = profileService.focusedClient;
      const unitValue = vm.unitValue;

      // TODO sinan ?? should be removed? used neither in class nor in html files
      if (utilityService.isCordova) {
        vm.hideAddress = false;
        vm.hideAmount = false;
      }

      const form = $scope.sendForm;
      if (!form) {
        return console.log('form is gone');
      }
      if (form.$invalid) {
        // TODO sinan why setSendError not used
        vm.error = gettextCatalog.getString('Unable to send transaction proposal');
        return;
      }
      if (fc.isPrivKeyEncrypted()) {
        profileService.unlockFC(null, (err) => {
          if (err) {
            return vm.setSendError(err.message);
          }
          return vm.submitForm();
        });
        return;
      }

      const asset = 'base';
      console.log(`asset ${asset}`);
      const address = form.address.$modelValue;
      const recipientDeviceAddress = assocDeviceAddressesByPaymentAddress[address];
      let amount = form.amount.$modelValue;
      const invoiceId = vm.invoiceId;
      // const paymentId = 1;
      let merkleProof = '';
      if (form.merkle_proof && form.merkle_proof.$modelValue) {
        merkleProof = form.merkle_proof.$modelValue.trim();
      }
      amount *= unitValue;
      amount = Math.round(amount);

      const currentPaymentKey = `${asset}${address}${amount}`;
      if (currentPaymentKey === vm.current_payment_key) {
        return $rootScope.$emit('Local/ShowErrorAlert', 'This payment is being processed');
      }
      vm.current_payment_key = currentPaymentKey;

      indexScope.setOngoingProcess(gettextCatalog.getString('sending'), true);
      $timeout(() => {
        const device = require('byteballcore/device.js');
        const sendCoinRequest = new SendCoinRequestBuilder()
          .binding(vm.binding)
          .recipientDeviceAddress(recipientDeviceAddress)
          .myDeviceAddress(device.getMyDeviceAddress())
          .sharedAddress(indexScope.shared_address)
          .copayers($scope.index.copayers)
          .invoiceId(invoiceId)
          .address(address)
          .merkleProof(merkleProof)
          .amount(amount)
          .requestTouchidCb((err) => {
            profileService.lockFC();
            indexScope.setOngoingProcess(gettextCatalog.getString('sending'), false);
            vm.error = err;
            $timeout(() => {
              delete vm.current_payment_key;
              $scope.$digest();
            }, 1);
          })
          .createNewSharedAddressCb((err) => {
            delete vm.current_payment_key;
            indexScope.setOngoingProcess(gettextCatalog.getString('sending'), false);
            vm.setSendError(err);
          })
          .sendMultiPaymentDoneBeforeCb((sendMultiPaymentError) => {
            // if multisig, it might take very long before the callback is called
            indexScope.setOngoingProcess(gettextCatalog.getString('sending'), false);
            breadcrumbs.add(`done payment in ${asset}, err=${sendMultiPaymentError}`);
            delete vm.current_payment_key;
            profileService.bKeepUnlocked = false;
          })
          .sendMultiPaymentDoneErrorCb((err) => {
            vm.setSendError(err);
          })
          .sendMultiPaymentDoneAfter((rcptDeviceAddress, toAddress, rAsset) => {
            vm.resetForm();
            $rootScope.$emit('NewOutgoingTx');
            if (rcptDeviceAddress) {
              eventBus.emit('sent_payment', rcptDeviceAddress, amount || 'all', rAsset, indexScope.walletId, true, toAddress);
            } else {
              indexScope.updateHistory((success) => {
                if (success) {
                  $state.go('wallet.home');
                  $rootScope.$emit('Local/SetTab', 'wallet.home');
                  vm.openTxModal(indexScope.txHistory[0]);
                } else {
                  console.error('updateTxHistory not executed');
                }
              });
            }
          })
          .composeAndSendDoneCb(() => {
            $scope.sendForm.$setPristine();
          })
          .composeAndSendErrorCb((error) => {
            delete vm.current_payment_key;
            indexScope.setOngoingProcess(gettextCatalog.getString('sending'), false);
            $rootScope.$emit('Local/ShowAlert', error, 'fi-alert', () => { });
          })
          .build();
        walletService.sendCoin(sendCoinRequest);
      }, 100);
    };

    vm.openBindModal = function () {
      $rootScope.modalOpened = true;
      const fc = profileService.focusedClient;
      const form = $scope.sendForm;
      if (!form || !form.address) {
        // disappeared
        return;
      }

      const ModalInstanceCtrl = function ($scope, $modalInstance) {
        $scope.color = fc.backgroundColor;
        $scope.arrPublicAssetInfos = indexScope.arrBalances.filter(b => !b.is_private).map((b) => {
          const r = { asset: b.asset, displayName: vm.unitName };
          return r;
        });
        $scope.binding = { // defaults
          type: 'reverse_payment',
          timeout: 4,
          reverseAsset: 'base',
          feed_type: 'either',
          oracle_address: ''
        };
        if (vm.binding) {
          $scope.binding.type = vm.binding.type;
          $scope.binding.timeout = vm.binding.timeout;
          if (vm.binding.type === 'reverse_payment') {
            $scope.binding.reverseAsset = vm.binding.reverseAsset;
            $scope.binding.reverseAmount = utilityService.getAmountInDisplayUnits(vm.binding.reverseAmount,
              vm.binding.reverseAsset,
              vm.unitValue);
          } else {
            $scope.binding.oracle_address = vm.binding.oracle_address;
            $scope.binding.feed_name = vm.binding.feed_name;
            $scope.binding.feed_value = vm.binding.feed_value;
            $scope.binding.feed_type = vm.binding.feed_type;
          }
        }

        $scope.cancel = function () {
          $modalInstance.dismiss('cancel');
        };

        $scope.bind = function () {
          const binding = { type: $scope.binding.type };
          if (binding.type === 'reverse_payment') {
            binding.reverseAsset = $scope.binding.reverseAsset;
            binding.reverseAmount = utilityService.getAmountInSmallestUnits($scope.binding.reverseAmount,
              $scope.binding.reverseAsset,
              vm.unitValue);
          } else {
            binding.oracle_address = $scope.binding.oracle_address;
            binding.feed_name = $scope.binding.feed_name;
            binding.feed_value = $scope.binding.feed_value;
            binding.feed_type = $scope.binding.feed_type;
          }
          binding.timeout = $scope.binding.timeout;
          vm.binding = binding;
          $modalInstance.dismiss('done');
        };
      };

      const modalInstance = $modal.open({
        templateUrl: 'views/modals/bind.html',
        windowClass: animationService.modalAnimated.slideUp,
        controller: ModalInstanceCtrl
      });

      const disableCloseModal = $rootScope.$on('closeModal', () => {
        modalInstance.dismiss('cancel');
      });

      modalInstance.result.finally(() => {
        $rootScope.modalOpened = false;
        disableCloseModal();
        const m = angular.element(document.getElementsByClassName('reveal-modal'));
        m.addClass(animationService.modalAnimated.slideOutDown);
      });
    };

    /**
     * Invoked when transaction is sent
     * @param btx
     */
    vm.openTxModal = function (btx) {
      transactionsService.openTxModal({
        btx,
        walletSettings,
        $rootScope
      });
    };

    $scope.$on('$viewContentLoaded', viewContentLoaded);
    $scope.$on('$destroy', destroy);
  }
})();
