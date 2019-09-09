import React from 'react';
import PropTypes from 'prop-types';
import {
	Text, View, InteractionManager
} from 'react-native';
import { connect } from 'react-redux';
import { RectButton } from 'react-native-gesture-handler';
import { SafeAreaView, HeaderBackButton } from 'react-navigation';
// eslint-disable-next-line import/no-extraneous-dependencies
import { throttleTime } from 'rxjs/operators';
import { sanitizedRaw } from '@nozbe/watermelondb/RawRecord';
import moment from 'moment';
import * as Haptics from 'expo-haptics';
import { Q } from '@nozbe/watermelondb';

import {
	replyBroadcast as replyBroadcastAction
} from '../../actions/messages';
import { List } from './List';
import database, { safeAddListener } from '../../lib/realm';
import watermelondb from '../../lib/database';
import RocketChat from '../../lib/rocketchat';
import Message from '../../containers/message';
import MessageActions from '../../containers/MessageActions';
import MessageErrorActions from '../../containers/MessageErrorActions';
import MessageBox from '../../containers/MessageBox';
import ReactionPicker from './ReactionPicker';
import UploadProgress from './UploadProgress';
import styles from './styles';
import log from '../../utils/log';
import EventEmitter from '../../utils/events';
import I18n from '../../i18n';
import RoomHeaderView, { RightButtons } from './Header';
import StatusBar from '../../containers/StatusBar';
import Separator from './Separator';
import { COLOR_WHITE, HEADER_BACK } from '../../constants/colors';
import debounce from '../../utils/debounce';
import FileModal from '../../containers/FileModal';
import ReactionsModal from '../../containers/ReactionsModal';
import { LISTENER } from '../../containers/Toast';
import { isReadOnly, isBlocked } from '../../utils/room';

class RoomView extends React.Component {
	static navigationOptions = ({ navigation }) => {
		const rid = navigation.getParam('rid');
		const prid = navigation.getParam('prid');
		const title = navigation.getParam('name');
		const t = navigation.getParam('t');
		const tmid = navigation.getParam('tmid');
		const room = navigation.getParam('room');
		const toggleFollowThread = navigation.getParam('toggleFollowThread', () => {});
		const unreadsCount = navigation.getParam('unreadsCount', null);
		return {
			headerTitle: (
				<RoomHeaderView
					rid={rid}
					prid={prid}
					tmid={tmid}
					title={title}
					type={t}
					widthOffset={tmid ? 95 : 130}
				/>
			),
			headerRight: (
				<RightButtons
					rid={rid}
					tmid={tmid}
					room={room}
					t={t}
					navigation={navigation}
					toggleFollowThread={toggleFollowThread}
				/>
			),
			headerLeft: (
				<HeaderBackButton
					title={unreadsCount > 999 ? '+999' : unreadsCount || ' '}
					backTitleVisible
					onPress={() => navigation.goBack()}
					tintColor={HEADER_BACK}
				/>
			)
		};
	}

	static propTypes = {
		navigation: PropTypes.object,
		user: PropTypes.shape({
			id: PropTypes.string.isRequired,
			username: PropTypes.string.isRequired,
			token: PropTypes.string.isRequired
		}),
		appState: PropTypes.string,
		useRealName: PropTypes.bool,
		isAuthenticated: PropTypes.bool,
		Message_GroupingPeriod: PropTypes.number,
		Message_TimeFormat: PropTypes.string,
		Message_Read_Receipt_Enabled: PropTypes.bool,
		baseUrl: PropTypes.string,
		customEmojis: PropTypes.object,
		useMarkdown: PropTypes.bool,
		replyBroadcast: PropTypes.func
	};

	constructor(props) {
		super(props);
		console.time(`${ this.constructor.name } init`);
		console.time(`${ this.constructor.name } mount`);
		this.rid = props.navigation.getParam('rid');
		this.t = props.navigation.getParam('t');
		this.tmid = props.navigation.getParam('tmid', null);
		const room = props.navigation.getParam('room');
		// this.rooms = database.objects('subscriptions').filtered('rid = $0', this.rid);
		this.chats = database.objects('subscriptions').filtered('rid != $0', this.rid);
		// const canAutoTranslate = RocketChat.canAutoTranslate();
		this.state = {
			// joined: this.rooms.length > 0,
			joined: true,
			room: room || { rid: this.rid, t: this.t },
			lastOpen: null,
			photoModalVisible: false,
			reactionsModalVisible: false,
			selectedAttachment: {},
			selectedMessage: {},
			canAutoTranslate: false,
			loading: true,
			showActions: false,
			showErrorActions: false,
			editing: false,
			replying: false,
			replyWithMention: false,
			reacting: false
		};

		if (room && room.observe) {
			this.roomObservable = room.observe();
			this.subscription = this.roomObservable
				.pipe(throttleTime(5000))
				.subscribe((changes) => {
					// TODO: compare changes?
					// this.forceUpdate();
					this.setState({ room: changes });
				});
		}

		this.beginAnimating = false;
		this.beginAnimatingTimeout = setTimeout(() => this.beginAnimating = true, 300);
		this.messagebox = React.createRef();
		this.willBlurListener = props.navigation.addListener('willBlur', () => this.mounted = false);
		this.mounted = false;
		console.timeEnd(`${ this.constructor.name } init`);
	}

	componentDidMount() {
		this.mounted = true;
		// this.didMountInteraction = InteractionManager.runAfterInteractions(() => {
		const { room } = this.state;
		console.log('TCL: componentDidMount -> room', room);
		const { navigation, isAuthenticated } = this.props;

		if (room._id && !this.tmid) {
			navigation.setParams({ name: this.getRoomTitle(room), t: room.t });
		}
		if (this.tmid) {
			navigation.setParams({ toggleFollowThread: this.toggleFollowThread });
		}

		if (isAuthenticated) {
			this.init();
		} else {
			EventEmitter.addEventListener('connected', this.handleConnected);
		}
		// safeAddListener(this.rooms, this.updateRoom);
		// safeAddListener(this.chats, this.updateUnreadCount);
		// });

		this.updateUnreadCount();

		console.timeEnd(`${ this.constructor.name } mount`);
	}

	// shouldComponentUpdate(nextProps, nextState) {
	// 	const {
	// 		room, joined, lastOpen, photoModalVisible, reactionsModalVisible, canAutoTranslate
	// 	} = this.state;
	// 	const { showActions, showErrorActions, appState } = this.props;

	// 	if (lastOpen !== nextState.lastOpen) {
	// 		return true;
	// 	} else if (photoModalVisible !== nextState.photoModalVisible) {
	// 		return true;
	// 	} else if (reactionsModalVisible !== nextState.reactionsModalVisible) {
	// 		return true;
	// 	} else if (room.ro !== nextState.room.ro) {
	// 		return true;
	// 	} else if (room.f !== nextState.room.f) {
	// 		return true;
	// 	} else if (room.blocked !== nextState.room.blocked) {
	// 		return true;
	// 	} else if (room.blocker !== nextState.room.blocker) {
	// 		return true;
	// 	} else if (room.archived !== nextState.room.archived) {
	// 		return true;
	// 	} else if (joined !== nextState.joined) {
	// 		return true;
	// 	} else if (canAutoTranslate !== nextState.canAutoTranslate) {
	// 		return true;
	// 	} else if (showActions !== nextProps.showActions) {
	// 		return true;
	// 	} else if (showErrorActions !== nextProps.showErrorActions) {
	// 		return true;
	// 	} else if (appState !== nextProps.appState) {
	// 		return true;
	// 	} else if (!equal(room.muted, nextState.room.muted)) {
	// 		return true;
	// 	}
	// 	return false;
	// }

	componentDidUpdate(prevProps) {
		const { room } = this.state;
		const { appState } = this.props;

		if (appState === 'foreground' && appState !== prevProps.appState) {
			this.onForegroundInteraction = InteractionManager.runAfterInteractions(() => {
				RocketChat.loadMissedMessages(room).catch(e => console.log(e));
				RocketChat.readMessages(room.rid).catch(e => console.log(e));
			});
		}
	}

	async componentWillUnmount() {
		const { editing, room } = this.state;
		const watermelon = watermelondb.database;
		this.mounted = false;
		if (!editing && this.messagebox && this.messagebox.current) {
			const { text } = this.messagebox.current;
			let obj;
			if (this.tmid) {
				try {
					const threadsCollection = watermelon.collections.get('threads');
					obj = await threadsCollection.find(this.tmid); // database.objectForPrimaryKey('threads', this.tmid);
				} catch (e) {
					log(e);
				}
			} else {
				obj = room;
			}
			if (obj) {
				await watermelon.action(async() => {
					await obj.update((r) => {
						r.draftMessage = text;
					});
				});
			}
		}
		// this.rooms.removeAllListeners();
		this.chats.removeAllListeners();
		if (this.sub && this.sub.stop) {
			this.sub.stop();
		}
		if (this.beginAnimatingTimeout) {
			clearTimeout(this.beginAnimatingTimeout);
		}
		// if (editing) {
		// 	const { editCancel } = this.props;
		// 	editCancel();
		// }
		// if (replying) {
		// 	const { replyCancel } = this.props;
		// 	replyCancel();
		// }
		if (this.didMountInteraction && this.didMountInteraction.cancel) {
			this.didMountInteraction.cancel();
		}
		if (this.onForegroundInteraction && this.onForegroundInteraction.cancel) {
			this.onForegroundInteraction.cancel();
		}
		if (this.updateStateInteraction && this.updateStateInteraction.cancel) {
			this.updateStateInteraction.cancel();
		}
		if (this.initInteraction && this.initInteraction.cancel) {
			this.initInteraction.cancel();
		}
		if (this.willBlurListener && this.willBlurListener.remove) {
			this.willBlurListener.remove();
		}
		EventEmitter.removeListener('connected', this.handleConnected);
		console.countReset(`${ this.constructor.name }.render calls`);
	}

	// eslint-disable-next-line react/sort-comp
	// observeRoom = async() => {
	// 	this.watermelon = watermelondb.database;
	// 	const subCollection = this.watermelon.collections.get('subscriptions');
	// 	this.subObservable = await subCollection.findAndObserve(this.rid);
	// 	this.subSubscription = this.subObservable
	// 		.subscribe((room) => {
	// 			if (this.mounted) {
	// 				console.log('ROOMVIEW: SET MOUNTED')
	// 				this.setState({ room });
	// 			} else {
	// 				console.log('ROOMVIEW: SET NOT MOUNTED')
	// 				this.state.room = room;
	// 			}
	// 		});
	// }

	// eslint-disable-next-line react/sort-comp
	init = () => {
		try {
			this.setState({ loading: true });
			this.initInteraction = InteractionManager.runAfterInteractions(async() => {
				const { room } = this.state;
				if (this.tmid) {
					await this.getThreadMessages();
				} else {
					const newLastOpen = new Date();
					await this.getMessages(room);

					// if room is joined
					if (room._id) {
						if (room.alert || room.unread || room.userMentions) {
							this.setLastOpen(room.ls);
						} else {
							this.setLastOpen(null);
						}
						RocketChat.readMessages(room.rid, newLastOpen).catch(e => console.log(e));
						this.sub = await RocketChat.subscribeRoom(room);
					}
				}

				// We run `canAutoTranslate` again in order to refetch auto translate permission
				// in case of a missing connection or poor connection on room open
				const canAutoTranslate = await RocketChat.canAutoTranslate();
				this.setState({ canAutoTranslate, loading: false });
			});
		} catch (e) {
			this.setState({ loading: false });
			log(e);
		}
	}

	errorActionsShow = (message) => {
		this.setState({ selectedMessage: message, showErrorActions: true });
	}

	onActionsHide = () => {
		const { editing, replying, reacting } = this.state;
		if (editing || replying || reacting) {
			return;
		}
		this.setState({ selectedMessage: {}, showActions: false });
	}

	onErrorActionsHide = () => {
		this.setState({ selectedMessage: {}, showErrorActions: false });
	}

	onEditInit = (message) => {
		this.setState({ selectedMessage: message, editing: true, showActions: false });
	}

	onEditCancel = () => {
		this.setState({ selectedMessage: {}, editing: false });
	}

	onEditRequest = async(message) => {
		this.setState({ selectedMessage: {}, editing: false });
		try {
			await RocketChat.editMessage(message);
		} catch (e) {
			log(e);
		}
	}

	onReplyInit = (message, mention) => {
		this.setState({
			selectedMessage: message, replying: true, showActions: false, replyWithMention: mention
		});
	}

	onReplyCancel = () => {
		this.setState({ selectedMessage: {}, replying: false });
	}

	onReactionInit = (message) => {
		this.setState({ selectedMessage: message, reacting: true, showActions: false });
	}

	onReactionClose = () => {
		this.setState({ selectedMessage: {}, reacting: false });
	}

	onMessageLongPress = (message) => {
		this.setState({ selectedMessage: message, showActions: true });
	}

	onOpenFileModal = (attachment) => {
		this.setState({ selectedAttachment: attachment, photoModalVisible: true });
	}

	onCloseFileModal = () => {
		this.setState({ selectedAttachment: {}, photoModalVisible: false });
	}

	onReactionPress = async(shortname, messageId) => {
		try {
			await RocketChat.setReaction(shortname, messageId);
			this.onReactionClose();
		} catch (e) {
			log(e);
		}
	};

	onReactionLongPress = (message) => {
		this.setState({ selectedMessage: message, reactionsModalVisible: true });
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
	}

	onCloseReactionsModal = () => {
		this.setState({ selectedMessage: {}, reactionsModalVisible: false });
	}

	onDiscussionPress = debounce((item) => {
		const { navigation } = this.props;
		navigation.push('RoomView', {
			rid: item.drid, prid: item.rid, name: item.msg, t: 'p'
		});
	}, 1000, true)

	// eslint-disable-next-line react/sort-comp
	updateUnreadCount = async() => {
		const watermelon = watermelondb.database;
		const observable = await watermelon.collections
			.get('subscriptions')
			.query(
				Q.where('archived', false),
				Q.where('open', true)
			)
			.observeWithColumns(['unread']);

		this.queryUnreads = observable.subscribe((data) => {
			const { navigation } = this.props;
			const unreadsCount = data.filter(s => s.unread > 0).reduce((a, b) => a + (b.unread || 0), 0);
			if (unreadsCount !== navigation.getParam('unreadsCount')) {
				navigation.setParams({
					unreadsCount
				});
			}
		});
	};

	onThreadPress = debounce(async(item) => {
		const { navigation } = this.props;
		if (item.tmid) {
			if (!item.tmsg) {
				await this.fetchThreadName(item.tmid, item.id);
			}
			navigation.push('RoomView', {
				rid: item.subscription.id, tmid: item.tmid, name: item.tmsg, t: 'thread'
			});
		} else if (item.tlm) {
			navigation.push('RoomView', {
				rid: item.subscription.id, tmid: item.id, name: item.msg, t: 'thread'
			});
		}
	}, 1000, true)

	replyBroadcast = (message) => {
		const { replyBroadcast } = this.props;
		replyBroadcast(message);
	}

	handleConnected = () => {
		this.init();
		EventEmitter.removeListener('connected', this.handleConnected);
	}

	internalSetState = (...args) => {
		if (!this.mounted) {
			return;
		}
		// if (isIOS && this.beginAnimating) {
		// 	LayoutAnimation.easeInEaseOut();
		// }
		this.setState(...args);
	}

	// updateRoom = () => {
	// 	this.updateStateInteraction = InteractionManager.runAfterInteractions(() => {
	// 		if (this.rooms[0]) {
	// 			const room = JSON.parse(JSON.stringify(this.rooms[0] || {}));
	// 			this.internalSetState({ room });
	// 		}
	// 	});
	// }

	sendMessage = (message, tmid) => {
		const { user } = this.props;
		// LayoutAnimation.easeInEaseOut();
		RocketChat.sendMessage(this.rid, message, this.tmid || tmid, user).then(() => {
			this.setLastOpen(null);
		});
	};

	getRoomTitle = (room) => {
		const { useRealName } = this.props;
		return ((room.prid || useRealName) && room.fname) || room.name;
	}

	getMessages = async() => {
		const { room } = this.state;
		try {
			if (room.lastOpen) {
				await RocketChat.loadMissedMessages(room);
			} else {
				await RocketChat.loadMessagesForRoom(room);
			}
			return Promise.resolve();
		} catch (e) {
			log(e);
		}
	}

	getThreadMessages = () => {
		try {
			return RocketChat.loadThreadMessages({ tmid: this.tmid, rid: this.rid });
		} catch (e) {
			log(e);
		}
	}

	getCustomEmoji = (name) => {
		const { customEmojis } = this.props;
		const emoji = customEmojis[name];
		if (emoji) {
			return emoji;
		}
		return null;
	}

	setLastOpen = lastOpen => this.setState({ lastOpen });

	joinRoom = async() => {
		try {
			await RocketChat.joinRoom(this.rid, this.t);
			this.internalSetState({
				joined: true
			});
		} catch (e) {
			log(e);
			console.log(e);
		}
	}

	// eslint-disable-next-line react/sort-comp
	fetchThreadName = async(tmid, messageId) => {
		try {
			const { room } = this.state;
			const watermelon = watermelondb.database;
			const threadCollection = watermelon.collections.get('threads');
			const messageCollection = watermelon.collections.get('messages');
			const messageRecord = await messageCollection.find(messageId);
			let threadRecord;
			try {
				threadRecord = await threadCollection.find(tmid);
			} catch (error) {
				console.log('Thread not found. We have to search for it.');
			}
			if (threadRecord) {
				await watermelon.action(async() => {
					await messageRecord.update((m) => {
						m.tmsg = threadRecord.msg || (threadRecord.attachments && threadRecord.attachments.length && threadRecord.attachments[0].title);
					});
				});
			} else {
				const thread = await RocketChat.getSingleMessage(tmid);
				await watermelon.action(async() => {
					await watermelon.batch(
						threadCollection.prepareCreate((t) => {
							t._raw = sanitizedRaw({ id: thread._id }, threadCollection.schema);
							t.subscription.set(room);
							Object.assign(t, thread);
						}),
						messageRecord.prepareUpdate((m) => {
							m.tmsg = thread.msg || (thread.attachments && thread.attachments.length && thread.attachments[0].title);
						})
					);
				});
			}
		} catch (e) {
			log(e);
		}
	}

	toggleFollowThread = async(isFollowingThread) => {
		try {
			await RocketChat.toggleFollowMessage(this.tmid, !isFollowingThread);
			EventEmitter.emit(LISTENER, { message: isFollowingThread ? 'Unfollowed thread' : 'Following thread' });
		} catch (e) {
			log(e);
			console.log(e);
		}
	}

	navToRoomInfo = (navParam) => {
		const { navigation, user } = this.props;
		if (navParam.rid === user.id) {
			return;
		}
		navigation.navigate('RoomInfoView', navParam);
	}

	renderItem = (item, previousItem) => {
		const { room, lastOpen, canAutoTranslate } = this.state;
		const {
			user, Message_GroupingPeriod, Message_TimeFormat, useRealName, baseUrl, useMarkdown, Message_Read_Receipt_Enabled
		} = this.props;
		let dateSeparator = null;
		let showUnreadSeparator = false;

		if (!previousItem) {
			dateSeparator = item.ts;
			showUnreadSeparator = moment(item.ts).isAfter(lastOpen);
		} else {
			showUnreadSeparator = lastOpen
				&& moment(item.ts).isAfter(lastOpen)
				&& moment(previousItem.ts).isBefore(lastOpen);
			if (!moment(item.ts).isSame(previousItem.ts, 'day')) {
				dateSeparator = item.ts;
			}
		}

		const message = (
			<Message
				item={item}
				user={user}
				archived={room.archived}
				broadcast={room.broadcast}
				status={item.status}
				isThreadRoom={!!this.tmid}
				_updatedAt={item._updatedAt} // TODO: need it?
				previousItem={previousItem}
				fetchThreadName={this.fetchThreadName}
				onReactionPress={this.onReactionPress}
				onReactionLongPress={this.onReactionLongPress}
				onLongPress={this.onMessageLongPress}
				onDiscussionPress={this.onDiscussionPress}
				onThreadPress={this.onThreadPress}
				onOpenFileModal={this.onOpenFileModal}
				reactionInit={this.onReactionInit}
				replyBroadcast={this.replyBroadcast}
				errorActionsShow={this.errorActionsShow}
				baseUrl={baseUrl}
				Message_GroupingPeriod={Message_GroupingPeriod}
				timeFormat={Message_TimeFormat}
				useRealName={useRealName}
				useMarkdown={useMarkdown}
				isReadReceiptEnabled={Message_Read_Receipt_Enabled}
				autoTranslateRoom={canAutoTranslate && room.autoTranslate}
				autoTranslateLanguage={room.autoTranslateLanguage}
				navToRoomInfo={this.navToRoomInfo}
				getCustomEmoji={this.getCustomEmoji}
			/>
		);

		if (showUnreadSeparator || dateSeparator) {
			return (
				<React.Fragment>
					{message}
					<Separator
						ts={dateSeparator}
						unread={showUnreadSeparator}
					/>
				</React.Fragment>
			);
		}

		return message;
	}

	renderFooter = () => {
		const {
			joined, room, selectedMessage, editing, replying, replyWithMention
		} = this.state;
		const { navigation, user } = this.props;

		if (!joined && !this.tmid) {
			return (
				<View style={styles.joinRoomContainer} key='room-view-join' testID='room-view-join'>
					<Text style={styles.previewMode}>{I18n.t('You_are_in_preview_mode')}</Text>
					<RectButton
						onPress={this.joinRoom}
						style={styles.joinRoomButton}
						activeOpacity={0.5}
						underlayColor={COLOR_WHITE}
					>
						<Text style={styles.joinRoomText} testID='room-view-join-button'>{I18n.t('Join')}</Text>
					</RectButton>
				</View>
			);
		}
		if (isReadOnly(room, user)) {
			return (
				<View style={styles.readOnly}>
					<Text style={styles.previewMode}>{I18n.t('This_room_is_read_only')}</Text>
				</View>
			);
		}
		if (isBlocked(room)) {
			return (
				<View style={styles.readOnly}>
					<Text style={styles.previewMode}>{I18n.t('This_room_is_blocked')}</Text>
				</View>
			);
		}
		return (
			<MessageBox
				ref={this.messagebox}
				onSubmit={this.sendMessage}
				rid={this.rid}
				tmid={this.tmid}
				roomType={room.t}
				isFocused={navigation.isFocused()}
				message={selectedMessage}
				editing={editing}
				editRequest={this.onEditRequest}
				editCancel={this.onEditCancel}
				replying={replying}
				replyWithMention={replyWithMention}
				replyCancel={this.onReplyCancel}
			/>
		);
	};

	renderActions = () => {
		const {
			room, selectedMessage, showActions, showErrorActions
		} = this.state;
		const {
			user, navigation
		} = this.props;
		if (!navigation.isFocused()) {
			return null;
		}
		return (
			<>
				{room.id && showActions
					? (
						<MessageActions
							tmid={this.tmid}
							room={room}
							user={user}
							message={selectedMessage}
							actionsHide={this.onActionsHide}
							editInit={this.onEditInit}
							replyInit={this.onReplyInit}
							reactionInit={this.onReactionInit}
						/>
					)
					: null
				}
				{showErrorActions ? (
					<MessageErrorActions
						message={selectedMessage}
						actionsHide={this.onErrorActionsHide}
					/>
				) : null}
			</>
		);
	}

	render() {
		console.count(`${ this.constructor.name }.render calls`);
		const {
			room, photoModalVisible, reactionsModalVisible, selectedAttachment, selectedMessage, loading, reacting
		} = this.state;
		const { user, baseUrl } = this.props;
		const { rid, t } = room;

		return (
			<SafeAreaView style={styles.container} testID='room-view' forceInset={{ vertical: 'never' }}>
				<StatusBar />
				<List rid={rid} t={t} tmid={this.tmid} room={room} renderRow={this.renderItem} loading={loading} />
				{this.renderFooter()}
				{this.renderActions()}
				<ReactionPicker
					show={reacting}
					message={selectedMessage}
					onEmojiSelected={this.onReactionPress}
					reactionClose={this.onReactionClose}
				/>
				<UploadProgress rid={this.rid} user={user} baseUrl={baseUrl} />
				<FileModal
					attachment={selectedAttachment}
					isVisible={photoModalVisible}
					onClose={this.onCloseFileModal}
					user={user}
					baseUrl={baseUrl}
				/>
				<ReactionsModal
					message={selectedMessage}
					isVisible={reactionsModalVisible}
					onClose={this.onCloseReactionsModal}
					user={user}
					baseUrl={baseUrl}
				/>
			</SafeAreaView>
		);
	}
}

const mapStateToProps = state => ({
	user: {
		id: state.login.user && state.login.user.id,
		username: state.login.user && state.login.user.username,
		token: state.login.user && state.login.user.token
	},
	appState: state.app.ready && state.app.foreground ? 'foreground' : 'background',
	useRealName: state.settings.UI_Use_Real_Name,
	isAuthenticated: state.login.isAuthenticated,
	Message_GroupingPeriod: state.settings.Message_GroupingPeriod,
	Message_TimeFormat: state.settings.Message_TimeFormat,
	useMarkdown: state.markdown.useMarkdown,
	customEmojis: state.customEmojis,
	baseUrl: state.settings.baseUrl || state.server ? state.server.server : '',
	Message_Read_Receipt_Enabled: state.settings.Message_Read_Receipt_Enabled
});

const mapDispatchToProps = dispatch => ({
	replyBroadcast: message => dispatch(replyBroadcastAction(message))
});

export default connect(mapStateToProps, mapDispatchToProps)(RoomView);
