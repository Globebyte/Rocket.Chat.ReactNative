import React from 'react';
import PropTypes from 'prop-types';
import {
	FlatList, View, Text, InteractionManager
} from 'react-native';
import { connect } from 'react-redux';
import { SafeAreaView } from 'react-navigation';
import moment from 'moment';
import orderBy from 'lodash/orderBy';
import { Q } from '@nozbe/watermelondb';
import { sanitizedRaw } from '@nozbe/watermelondb/RawRecord';

import styles from './styles';
import Message from '../../containers/message';
import RCActivityIndicator from '../../containers/ActivityIndicator';
import I18n from '../../i18n';
import RocketChat from '../../lib/rocketchat';
import watermelondb from '../../lib/database';
import StatusBar from '../../containers/StatusBar';
import buildMessage from '../../lib/methods/helpers/buildMessage';
import log from '../../utils/log';
import debounce from '../../utils/debounce';
import protectedFunction from '../../lib/methods/helpers/protectedFunction';

const Separator = React.memo(() => <View style={styles.separator} />);
const API_FETCH_COUNT = 50;

class ThreadMessagesView extends React.Component {
	static navigationOptions = {
		title: I18n.t('Threads')
	}

	static propTypes = {
		user: PropTypes.object,
		navigation: PropTypes.object,
		baseUrl: PropTypes.string,
		useRealName: PropTypes.bool
	}

	constructor(props) {
		super(props);
		this.mounted = false;
		this.rid = props.navigation.getParam('rid');
		this.t = props.navigation.getParam('t');
		this.subscribeData();
		this.state = {
			loading: false,
			end: false,
			messages: []
		};
	}

	componentDidMount() {
		this.mounted = true;
		this.mountInteraction = InteractionManager.runAfterInteractions(() => {
			this.init();
		});
	}

	componentWillUnmount() {
		if (this.mountInteraction && this.mountInteraction.cancel) {
			this.mountInteraction.cancel();
		}
		if (this.loadInteraction && this.loadInteraction.cancel) {
			this.loadInteraction.cancel();
		}
		if (this.syncInteraction && this.syncInteraction.cancel) {
			this.syncInteraction.cancel();
		}
		if (this.subSubscription && this.subSubscription.unsubscribe) {
			this.subSubscription.unsubscribe();
		}
		if (this.messagesSubscription && this.messagesSubscription.unsubscribe) {
			this.messagesSubscription.unsubscribe();
		}
	}

	// eslint-disable-next-line react/sort-comp
	subscribeData = () => {
		try {
			const watermelon = watermelondb.database;
			this.subObservable = watermelon.collections
				.get('subscriptions')
				.findAndObserve(this.rid);
			this.subSubscription = this.subObservable
				.subscribe((data) => {
					this.subscription = data;
				});
			this.messagesObservable = watermelon.collections
				.get('threads')
				.query(
					Q.where('rid', this.rid),
					Q.where('t', Q.notEq('rm'))
				)
				.observeWithColumns(['updated_at']);
			this.messagesSubscription = this.messagesObservable
				.subscribe((data) => {
					const messages = orderBy(data, ['ts'], ['desc']);
					if (this.mounted) {
						this.setState({ messages });
					} else {
						this.state.messages = messages;
					}
				});
		} catch (e) {
			log(e);
		}
	}

	// eslint-disable-next-line react/sort-comp
	init = () => {
		if (!this.subscription) {
			return;
		}
		try {
			const lastThreadSync = new Date();
			if (this.subscription.lastThreadSync) {
				this.sync(this.subscription.lastThreadSync);
			} else {
				this.load(lastThreadSync);
			}
		} catch (e) {
			log(e);
		}
	}

	updateThreads = async({ update, remove, lastThreadSync }) => {
		try {
			const watermelon = watermelondb.database;
			const threadsCollection = watermelon.collections.get('threads');
			const allThreadsRecords = await this.subscription.threads.fetch();
			let threadsToCreate = [];
			let threadsToUpdate = [];
			let threadsToDelete = [];

			if (update && update.length) {
				update = update.map(m => buildMessage(m));
				// filter threads
				threadsToCreate = update.filter(i1 => !allThreadsRecords.find(i2 => i1._id === i2.id));
				threadsToUpdate = allThreadsRecords.filter(i1 => update.find(i2 => i1.id === i2._id));
				threadsToCreate = threadsToCreate.map(thread => threadsCollection.prepareCreate(protectedFunction((t) => {
					t._raw = sanitizedRaw({ id: thread._id }, threadsCollection.schema);
					t.subscription.set(this.subscription);
					Object.assign(t, thread);
				})));
				threadsToUpdate = threadsToUpdate.map((thread) => {
					const newThread = update.find(t => t._id === thread.id);
					return thread.prepareUpdate(protectedFunction((t) => {
						Object.assign(t, newThread);
					}));
				});
			}

			if (remove && remove.length) {
				threadsToDelete = allThreadsRecords.filter(i1 => remove.find(i2 => i1.id === i2._id));
				threadsToDelete = threadsToDelete.map(emoji => emoji.prepareDestroyPermanently());
			}

			await watermelon.action(async() => {
				await watermelon.batch(
					...threadsToCreate,
					...threadsToUpdate,
					...threadsToDelete,
					this.subscription.prepareUpdate((s) => {
						s.lastThreadSync = lastThreadSync;
					})
				);
			});
		} catch (e) {
			log(e);
		}
	}

	// eslint-disable-next-line react/sort-comp
	load = debounce(async(lastThreadSync) => {
		const { loading, end, messages } = this.state;
		if (end || loading || !this.mounted) {
			return;
		}

		this.setState({ loading: true });

		try {
			const result = await RocketChat.getThreadsList({
				rid: this.rid, count: API_FETCH_COUNT, offset: messages.length
			});
			if (result.success) {
				this.loadInteraction = InteractionManager.runAfterInteractions(() => {
					this.updateThreads({ update: result.threads, lastThreadSync });

					this.setState({
						loading: false,
						end: result.count < API_FETCH_COUNT
					});
				});
			}
		} catch (e) {
			log(e);
			this.setState({ loading: false, end: true });
		}
	}, 300)

	// eslint-disable-next-line react/sort-comp
	sync = async(updatedSince) => {
		this.setState({ loading: true });

		try {
			const result = await RocketChat.getSyncThreadsList({
				rid: this.rid, updatedSince: updatedSince.toISOString()
			});
			if (result.success && result.threads) {
				this.syncInteraction = InteractionManager.runAfterInteractions(() => {
					const { update, remove } = result.threads;
					this.updateThreads({ update, remove, lastThreadSync: updatedSince });
				});
			}
			this.setState({
				loading: false
			});
		} catch (e) {
			log(e);
			this.setState({ loading: false });
		}
	}

	formatMessage = lm => (
		lm ? moment(lm).calendar(null, {
			lastDay: `[${ I18n.t('Yesterday') }]`,
			sameDay: 'h:mm A',
			lastWeek: 'dddd',
			sameElse: 'MMM D'
		}) : null
	)

	onThreadPress = debounce((item) => {
		const { navigation } = this.props;
		navigation.push('RoomView', {
			rid: item.subscription.id, tmid: item.id, name: item.msg, t: 'thread'
		});
	}, 1000, true)

	renderSeparator = () => <Separator />

	renderEmpty = () => (
		<View style={styles.listEmptyContainer} testID='thread-messages-view'>
			<Text style={styles.noDataFound}>{I18n.t('No_thread_messages')}</Text>
		</View>
	)

	renderItem = ({ item }) => {
		const {
			user, navigation, baseUrl, useRealName
		} = this.props;
		return (
			<Message
				key={item.id}
				item={item}
				user={user}
				archived={false}
				broadcast={false}
				status={item.status}
				_updatedAt={item._updatedAt}
				navigation={navigation}
				timeFormat='MMM D'
				customThreadTimeFormat='MMM Do YYYY, h:mm:ss a'
				onThreadPress={this.onThreadPress}
				baseUrl={baseUrl}
				useRealName={useRealName}
			/>
		);
	}

	render() {
		const { loading, messages } = this.state;

		if (!loading && messages.length === 0) {
			return this.renderEmpty();
		}

		return (
			<SafeAreaView style={styles.list} testID='thread-messages-view' forceInset={{ vertical: 'never' }}>
				<StatusBar />
				<FlatList
					data={messages}
					extraData={this.state}
					renderItem={this.renderItem}
					style={styles.list}
					contentContainerStyle={styles.contentContainer}
					keyExtractor={item => item.id}
					onEndReached={this.load}
					onEndReachedThreshold={0.5}
					maxToRenderPerBatch={5}
					initialNumToRender={1}
					ItemSeparatorComponent={this.renderSeparator}
					ListFooterComponent={loading ? <RCActivityIndicator /> : null}
				/>
			</SafeAreaView>
		);
	}
}

const mapStateToProps = state => ({
	baseUrl: state.settings.Site_Url || state.server ? state.server.server : '',
	user: {
		id: state.login.user && state.login.user.id,
		username: state.login.user && state.login.user.username,
		token: state.login.user && state.login.user.token
	},
	useRealName: state.settings.UI_Use_Real_Name
});

export default connect(mapStateToProps)(ThreadMessagesView);
