angular.module('blocktrail.wallet')
    .controller('BuyBTCChooseCtrl', function($q, $scope, $state, $rootScope, $cordovaDialogs, settingsService, $ionicLoading,
                                             $translate, $ionicScrollDelegate, glideraService, buyBTCService, $log) {
        $scope.brokers = [];

        // load chooseRegion from settingsService
        //  show loading spinner while we wait (should be microseconds)
        $scope.chooseRegion = null;
        $scope.chooseState = {
            gettingStarted: true
        };
        $ionicLoading.show({
            template: "<div>{{ 'WORKING' | translate }}...</div><ion-spinner></ion-spinner>",
            hideOnStateChange: true
        });
        settingsService.$isLoaded().then(function() {
            $q.all([
                buyBTCService.regions().then(function(regions) {
                    $scope.regions = regions;
                }),
                buyBTCService.usStates().then(function(usStates) {
                    $scope.usStates = usStates;
                })
            ]).then(function() {
                $scope.chooseRegion = _.defaults({}, settingsService.buyBTCRegion, {
                    code: null,
                    name: null
                });
                $scope.chooseState.gettingStarted = !$scope.chooseRegion.code;

                return buyBTCService.regionBrokers($scope.chooseRegion.code).then(function(brokers) {
                    $scope.brokers = brokers;
                    $scope.chooseRegion.regionOk = $scope.brokers.length;

                    $ionicLoading.hide();
                });
            });
        });

        $scope.selectRegion = function(region, name) {
            $log.debug('selectRegion: ' + region + ' (' + name + ')');
            $scope.chooseRegion.code = region;
            $scope.chooseRegion.name = name;

            buyBTCService.regionBrokers($scope.chooseRegion.code).then(function(brokers) {
                $scope.brokers = brokers;
                $scope.chooseRegion.regionOk = $scope.brokers.length;

                $ionicScrollDelegate.scrollTop();

                settingsService.$isLoaded().then(function() {
                    settingsService.buyBTCRegion = _.defaults({}, $scope.chooseRegion);
                    return settingsService.$store().then(function() {
                        return settingsService.$syncSettingsUp();
                    });
                })
            });
        };

        $scope.goGlideraBrowser = function() {
            glideraService.userCanTransact().then(function(userCanTransact) {
                if (!userCanTransact) {
                    return glideraService.accessToken().then(function(accessToken) {
                        if (accessToken) {
                            return settingsService.$isLoaded().then(function() {
                                // 2: Additional user verification information is required
                                if (settingsService.glideraAccessToken.userCanTransactInfo.code == 2) {
                                    return $cordovaDialogs.confirm(
                                        $translate.instant('MSG_BUYBTC_SETUP_MORE_GLIDERA_BODY', {
                                            message: settingsService.glideraAccessToken.userCanTransactInfo.message
                                        }).sentenceCase(),
                                        $translate.instant('MSG_BUYBTC_SETUP_MORE_GLIDERA_TITLE').sentenceCase(),
                                        [$translate.instant('OK'), $translate.instant('CANCEL').sentenceCase()]
                                    )
                                        .then(function(dialogResult) {
                                            if (dialogResult == 2) {
                                                return;
                                            }

                                            return glideraService.setup();
                                        })
                                    ;

                                } else if (settingsService.glideraAccessToken.userCanTransactInfo) {
                                    throw new Error("User can't transact because: " + settingsService.glideraAccessToken.userCanTransactInfo.message);
                                } else {
                                    throw new Error("User can't transact for unknown reason!");
                                }
                            });

                        } else {
                            return $cordovaDialogs.confirm(
                                $translate.instant('MSG_BUYBTC_SETUP_GLIDERA_BODY').sentenceCase(),
                                $translate.instant('MSG_BUYBTC_SETUP_GLIDERA_TITLE').sentenceCase(),
                                [$translate.instant('OK'), $translate.instant('CANCEL').sentenceCase()]
                            )
                                .then(function(dialogResult) {
                                    if (dialogResult == 2) {
                                        return;
                                    }

                                    return glideraService.oauth2();
                                })
                            ;
                        }
                    });
                } else {
                    $state.go('app.wallet.buybtc.buy', {broker: 'glidera'});
                }
            })
                .then(function() {
                    // -
                }, function(err) {
                    alert(err);
                })
            ;
        };

        /**
         * reset buy BTC state for debugging purposes
         */
        $scope.resetBuyBTC = function() {
            return settingsService.$isLoaded().then(function() {
                settingsService.glideraAccessToken = null;
                settingsService.glideraTransactions = [];
                settingsService.buyBTCRegion = null;

                return settingsService.$store().then(function() {
                    return settingsService.$syncSettingsUp();
                })
            })
                .then(function() {
                    $state.go('app.wallet.summary');
                }, function(err) {
                    alert(err);
                })
            ;
        };
    })
;

angular.module('blocktrail.wallet')
    .controller('BuyBTCChooseRegionCtrl', function($q, $scope, $log) {
        $scope.usSelected = false;

        $scope.selectUS = function() {
            $scope.usSelected = true;
        };
    })
;

angular.module('blocktrail.wallet')
    .controller('BuyBTCGlideraOauthCallbackCtrl', function($scope, $state, $rootScope, $ionicLoading, glideraService) {
        glideraService.handleOauthCallback($rootScope.glideraCallback)
            .then(function() {
                return glideraService.userCanTransact().then(function(userCanTransact) {
                    if (userCanTransact) {
                        $state.go('app.wallet.buybtc.buy', {broker: 'glidera'});
                    } else {
                        $state.go('app.wallet.buybtc.choose');
                    }
                })
            }, function(err) {
                console.error("" + err);
                $state.go('app.wallet.buybtc.choose');
            })
        ;
    })
;

angular.module('blocktrail.wallet')
    .controller('BuyBTCBuyCtrl', function($scope, $state, $rootScope, $ionicLoading, $cordovaDialogs, glideraService, buyBTCService,
                                          $stateParams, $log, $timeout, $interval, $translate, $filter, CurrencyConverter, CONFIG) {
        $scope.broker = $stateParams.broker;

        $scope.priceBTCCurrency = 'USD';
        $scope.fetchingInputPrice = false;
        $scope.fiatFirst = false;
        $scope.buyInput = {
            displayFee: CONFIG.DISPLAY_FEE,
            btcValue: 0.00,
            fiatValue: 0.00,
            feeValue: null,
            feePercentage: null,
            recipientAddress: null,
            referenceMessage: "",
            pin: null,

            recipient: null,        //contact object when sending to contact
            recipientDisplay: null,  //recipient as displayed on screen
            recipientSource: null
        };

        $scope.swapInputs = function() {
            if (!$scope.fiatFirst && $scope.settings.localCurrency != 'USD') {
                return $cordovaDialogs.confirm(
                    $translate.instant('MSG_BUYBTC_FIAT_USD_ONLY', {
                        currency: 'USD',
                        yourCurrency: $scope.settings.localCurrency
                    }).sentenceCase(),
                    $translate.instant('MSG_BUYBTC_FIAT_USD_ONLY_TITLE').sentenceCase(),
                    [$translate.instant('OK'), $translate.instant('CANCEL').sentenceCase()]
                )
                    .then(function(dialogResult) {
                        if (dialogResult == 2) {
                            return;
                        }

                        $scope.fiatFirst = !$scope.fiatFirst;
                    })
                ;
            } else {
                $scope.fiatFirst = !$scope.fiatFirst;
            }
        };

        $scope.setFiat = function() {
            updateInputPrice();
        };
        $scope.setBTC = function() {
            updateInputPrice();
        };

        var updateInputPrice = function() {
            $scope.fetchingInputPrice = true;

            if ($scope.fiatFirst) {
                $scope.buyInput.btcValue = null;
                $scope.buyInput.feeValue = null;
                $scope.buyInput.btcPrice = null;

                return glideraService.buyPrices(null, $scope.buyInput.fiatValue).then(function(result) {
                    $timeout(function() {
                        $scope.buyInput.btcValue = parseFloat(result.qty);
                        $scope.buyInput.feeValue = parseFloat(result.fees);
                        $scope.buyInput.btcPrice = parseFloat(result.total) / parseFloat(result.qty);
                        $scope.buyInput.feePercentage = ($scope.buyInput.feeValue / $scope.buyInput.fiatValue) * 100;
                        $scope.fetchingInputPrice = false;
                    });
                });
            } else {
                $scope.buyInput.fiatValue = null;
                $scope.buyInput.feeValue = null;
                $scope.buyInput.btcPrice = null;

                return glideraService.buyPrices($scope.buyInput.btcValue, null).then(function(result) {
                    $timeout(function() {
                        $scope.buyInput.fiatValue = parseFloat(result.total);
                        $scope.buyInput.feeValue = parseFloat(result.fees);
                        $scope.buyInput.btcPrice = parseFloat(result.total) / parseFloat(result.qty);
                        $scope.buyInput.feePercentage = ($scope.buyInput.feeValue / $scope.buyInput.fiatValue) * 100;
                        $scope.fetchingInputPrice = false;
                    });
                });
            }
        };

        var init = function() {
            // $ionicLoading.show({
            //     template: "<div>{{ 'WORKING' | translate }}...</div><ion-spinner></ion-spinner>",
            //     hideOnStateChange: true
            // });

            // update every minute
            $interval(function() {
                // update input price
                updateInputPrice();
            }, 60 * 1000);
        };

        $scope.$on('$ionicView.enter', function() {
            init();
        });

        $scope.buyBTC = function() {
            if ($scope.broker == 'glidera') {
                var btcValue = null, fiatValue = null;
                if ($scope.fiatFirst) {
                    fiatValue = $scope.buyInput.fiatValue;
                } else {
                    btcValue = $scope.buyInput.btcValue;
                }

                $ionicLoading.show();

                return glideraService.buyPricesUuid(btcValue, fiatValue)
                    .then(function(result) {
                        $ionicLoading.hide();

                        return $cordovaDialogs.confirm(
                            $translate.instant('MSG_BUYBTC_CONFIRM_BODY', {
                                qty: $filter('number')(result.qty, 6),
                                price: $filter('number')(result.total, 2),
                                fee: $filter('number')(result.fees, 2),
                                currencySymbol: $filter('toCurrencySymbol')('USD')
                            }).sentenceCase(),
                            $translate.instant('MSG_BUYBTC_CONFIRM_TITLE').sentenceCase(),
                            [$translate.instant('OK'), $translate.instant('CANCEL').sentenceCase()]
                        )
                            .then(function(dialogResult) {
                                if (dialogResult == 2) {
                                    return;
                                }

                                $ionicLoading.show();

                                return glideraService.buy(result.qty, result.priceUuid)
                                    .then(function(result) {
                                        $ionicLoading.hide();

                                        $cordovaDialogs.alert(
                                            $translate.instant('MSG_BUYBTC_BOUGHT_BODY', {
                                                qty: $filter('number')(result.qty, 6),
                                                price: $filter('number')(result.total, 2),
                                                fee: $filter('number')(result.fees, 2),
                                                currencySymbol: $filter('toCurrencySymbol')('USD')
                                            }).sentenceCase(),
                                            $translate.instant('MSG_BUYBTC_BOUGHT_TITLE').sentenceCase(),
                                            $translate.instant('OK')
                                        );

                                        $state.go('app.wallet.summary');
                                    }, function(e) {
                                        $log.debug(e.code);
                                        $log.debug(e.details);
                                        $log.debug(e.invalidParameters);
                                        alert(e.details);
                                        $ionicLoading.hide();
                                    })
                                    ;
                            });
                    })
                    .then(function() {
                        // -
                    }, function(err) {
                        if (err != "CANCELLED") {
                            alert(err);
                        }
                    });
            } else {
                alert("Unknown broker");
            }
        };
    })
;