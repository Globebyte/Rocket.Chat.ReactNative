import React from 'react';
import PropTypes from 'prop-types';
import { View, Text, Animated } from 'react-native';
import {
	RectButton,
	PanGestureHandler,
	State
} from 'react-native-gesture-handler';

import Avatar from '../../containers/Avatar';
import I18n from '../../i18n';
import styles, {
	ROW_HEIGHT,
	ACTION_WIDTH,
	SMALL_SWIPE,
	LONG_SWIPE
} from './styles';
import UnreadBadge from './UnreadBadge';
import TypeIcon from './TypeIcon';
import LastMessage from './LastMessage';
import { capitalize, formatDate } from '../../utils/room';
import { LeftActions, RightActions } from './Actions';

export { ROW_HEIGHT };

const attrs = [
	'name',
	'unread',
	'userMentions',
	'showLastMessage',
	'alert',
	'type',
	'width',
	'isRead',
	'favorite'
];

class RoomItem extends React.Component {
	static propTypes = {
		type: PropTypes.string.isRequired,
		name: PropTypes.string.isRequired,
		baseUrl: PropTypes.string.isRequired,
		showLastMessage: PropTypes.bool,
		_updatedAt: PropTypes.string,
		lastMessage: PropTypes.object,
		alert: PropTypes.bool,
		unread: PropTypes.number,
		userMentions: PropTypes.number,
		id: PropTypes.string,
		prid: PropTypes.string,
		onPress: PropTypes.func,
		userId: PropTypes.string,
		username: PropTypes.string,
		token: PropTypes.string,
		avatarSize: PropTypes.number,
		testID: PropTypes.string,
		width: PropTypes.number,
		favorite: PropTypes.bool,
		isRead: PropTypes.bool,
		rid: PropTypes.string,
		toggleFav: PropTypes.func,
		toggleRead: PropTypes.func,
		hideChannel: PropTypes.func
	};

	static defaultProps = {
		avatarSize: 48
	};

	constructor(props) {
		super(props);
		this.dragX = new Animated.Value(0);
		this.rowOffSet = new Animated.Value(0);
		this.transX = Animated.add(
			this.rowOffSet,
			this.dragX
		);
		this.state = {
			rowState: 0 // 0: closed, 1: right opened, -1: left opened
		};
		this._onGestureEvent = Animated.event(
			[{ nativeEvent: { translationX: this.dragX } }]
		);
		this._value = 0;
	}

	componentDidMount() {
		const { item } = this.props;
		if (item && item.observe) {
			const observable = item.observe();
			this.subscription = observable.subscribe((changes) => {
				// TODO: compare changes?
				this.forceUpdate();
				// this.setState({ subscriptions: changes });
			});
		}
	}

	shouldComponentUpdate(nextProps) {
		// const { item: { _updatedAt, lastMessage } } = this.props;
		// const oldlastMessage = lastMessage;
		// const newLastmessage = nextProps.item.lastMessage;

		// // console.log(oldlastMessage.ts, newLastmessage.ts)
		// if (oldlastMessage && newLastmessage && oldlastMessage.ts !== newLastmessage.ts) {
		// 	return true;
		// }
		// // if (_updatedAt && nextProps.item._updatedAt && nextProps.item._updatedAt.toISOString() !== _updatedAt.toISOString()) {
		// // 	return true;
		// // }
		// // // eslint-disable-next-line react/destructuring-assignment
		// // return attrs.some(key => nextProps.item[key] !== this.props.item[key]);
		// if (nextProps.name === 'Tests') {
		// 	console.log(nextProps.item, this.props.item)
		// 	// console.log(nextProps.item._updatedAt.toISOString(), this.props.item._updatedAt.toISOString())
		// }
		// return nextProps.item._updatedAt.toISOString() !== this.props.item._updatedAt.toISOString()
		// return true;

		// console.log(this.props.item, nextProps.item)
		// return true;
		return false;
	}

	componentWillUnmount() {
		if (this.subscription && this.subscription.unsubscribe) {
			this.subscription.unsubscribe();
		}
	}

	// componentWillReceiveProps(nextProps) {
	// 	// this.forceUpdate();
	// 	if (nextProps.name === 'diego.mello2') {
	// 		console.log('TCL: RoomItem -> componentWillReceiveProps -> nextProps', nextProps, this.props);
	// 		if (nextProps._updatedAt !== this.props._updatedAt) {
	// 			console.log('UPDATEEEEEEEERERERE')
	// 		}
	// 		if (nextProps.item._updatedAt.toISOString() !== this.props.item._updatedAt.toISOString()) {
	// 			console.log('UPDATEEEEEEEERERERE')
	// 		}
	// 	}
	// }

	_onHandlerStateChange = ({ nativeEvent }) => {
		if (nativeEvent.oldState === State.ACTIVE) {
			this._handleRelease(nativeEvent);
		}
	};

	_handleRelease = (nativeEvent) => {
		const { translationX } = nativeEvent;
		const { rowState } = this.state;
		this._value = this._value + translationX;

		let toValue = 0;
		if (rowState === 0) { // if no option is opened
			if (translationX > 0 && translationX < LONG_SWIPE) {
				toValue = ACTION_WIDTH; // open left option if he swipe right but not enough to trigger action
				this.setState({ rowState: -1 });
			} else if (translationX >= LONG_SWIPE) {
				toValue = 0;
				this.toggleRead();
			} else if (translationX < 0 && translationX > -LONG_SWIPE) {
				toValue = -2 * ACTION_WIDTH; // open right option if he swipe left
				this.setState({ rowState: 1 });
			} else if (translationX <= -LONG_SWIPE) {
				toValue = 0;
				this.setState({ rowState: 0 });
				this.hideChannel();
			} else {
				toValue = 0;
			}
		}

		if (rowState === -1) { // if left option is opened
			if (this._value < SMALL_SWIPE) {
				toValue = 0;
				this.setState({ rowState: 0 });
			} else if (this._value > LONG_SWIPE) {
				toValue = 0;
				this.setState({ rowState: 0 });
				this.toggleRead();
			} else {
				toValue = ACTION_WIDTH;
			}
		}

		if (rowState === 1) { // if right option is opened
			if (this._value > -2 * SMALL_SWIPE) {
				toValue = 0;
				this.setState({ rowState: 0 });
			} else if (this._value < -LONG_SWIPE) {
				toValue = 0;
				this.setState({ rowState: 0 });
				this.hideChannel();
			} else {
				toValue = -2 * ACTION_WIDTH;
			}
		}
		this._animateRow(toValue);
	}

	_animateRow = (toValue) => {
		this.rowOffSet.setValue(this._value);
		this._value = toValue;
		this.dragX.setValue(0);
		Animated.spring(this.rowOffSet, {
			toValue,
			bounciness: 0,
			useNativeDriver: true
		}).start();
	}

	close = () => {
		this.setState({ rowState: 0 });
		this._animateRow(0);
	}

	toggleFav = () => {
		const { toggleFav, rid, favorite } = this.props;
		if (toggleFav) {
			toggleFav(rid, favorite);
		}
		this.close();
	};

	toggleRead = () => {
		const { toggleRead, rid, isRead } = this.props;
		if (toggleRead) {
			toggleRead(rid, isRead);
		}
	};

	hideChannel = () => {
		const { hideChannel, rid, type } = this.props;
		if (hideChannel) {
			hideChannel(rid, type);
		}
	};

	onToggleReadPress = () => {
		this.toggleRead();
		this.close();
	};

	onHidePress = () => {
		this.hideChannel();
		this.close();
	};

	onPress = () => {
		const { rowState } = this.state;
		if (rowState !== 0) {
			this.close();
			return;
		}
		const { onPress } = this.props;
		if (onPress) {
			onPress();
		}
	};

	render() {
		const {
			item,
			testID,
			name,
			avatarSize,
			baseUrl,
			userId,
			username,
			token,
			showLastMessage,
			width
		} = this.props;
		const {
			_updatedAt,
			lastMessage,
			unread,
			alert,
			userMentions,
			t,
			prid,
			isRead,
			favorite
		} = item;
		const id = item.rid.replace(userId, '').trim();

		const date = formatDate(_updatedAt);

		// // FIXME: it's updating rows while scrolling
		if (name === 'Tests') {
			console.log('RENRENRENRNERENRENRENRENRERN TESTS');
		}

		let accessibilityLabel = name;
		if (unread === 1) {
			accessibilityLabel += `, ${ unread } ${ I18n.t('alert') }`;
		} else if (unread > 1) {
			accessibilityLabel += `, ${ unread } ${ I18n.t('alerts') }`;
		}

		if (userMentions > 0) {
			accessibilityLabel += `, ${ I18n.t('you_were_mentioned') }`;
		}

		if (date) {
			accessibilityLabel += `, ${ I18n.t('last_message') } ${ date }`;
		}

		return (
			<PanGestureHandler
				minDeltaX={20}
				onGestureEvent={this._onGestureEvent}
				onHandlerStateChange={this._onHandlerStateChange}
			>
				<Animated.View>
					<LeftActions
						transX={this.transX}
						isRead={isRead}
						width={width}
						onToggleReadPress={this.onToggleReadPress}
					/>
					<RightActions
						transX={this.transX}
						favorite={favorite}
						width={width}
						toggleFav={this.toggleFav}
						onHidePress={this.onHidePress}
					/>
					<Animated.View
						style={{
							transform: [{ translateX: this.transX }]
						}}
					>
						<RectButton
							onPress={this.onPress}
							activeOpacity={0.8}
							underlayColor='#e1e5e8'
							testID={testID}
							style={styles.button}
						>
							<View
								style={styles.container}
								accessibilityLabel={accessibilityLabel}
							>
								<Avatar
									text={name}
									size={avatarSize}
									type={t}
									baseUrl={baseUrl}
									style={styles.avatar}
									userId={userId}
									token={token}
								/>
								<View style={styles.centerContainer}>
									<View style={styles.titleContainer}>
										<TypeIcon
											type={t}
											id={id}
											prid={prid}
										/>
										<Text
											style={[
												styles.title,
												alert && styles.alert
											]}
											ellipsizeMode='tail'
											numberOfLines={1}
										>
											{name}
										</Text>
										{_updatedAt ? (
											<Text
												style={[
													styles.date,
													alert && styles.updateAlert
												]}
												ellipsizeMode='tail'
												numberOfLines={1}
											>
												{capitalize(date)}
											</Text>
										) : null}
									</View>
									<View style={styles.row}>
										<LastMessage
											lastMessage={lastMessage}
											type={t}
											showLastMessage={showLastMessage}
											username={username}
											alert={alert}
										/>
										<UnreadBadge
											unread={unread}
											userMentions={userMentions}
											type={t}
										/>
									</View>
								</View>
							</View>
						</RectButton>
					</Animated.View>
				</Animated.View>
			</PanGestureHandler>
		);
	}
}

// const Item = withObservables(['item'], ({ item }) => ({
// 	item: item.observe().pipe(throttleTime(1000))
// }))(RoomItem);

export default RoomItem;
