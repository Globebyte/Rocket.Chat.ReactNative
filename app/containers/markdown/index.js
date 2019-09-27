import React, { PureComponent } from 'react';
import { View, Text, Image } from 'react-native';
import { Parser, Node } from 'commonmark';
import Renderer from 'commonmark-react-renderer';
import PropTypes from 'prop-types';
import { toShort, shortnameToUnicode } from 'emoji-toolkit';

import I18n from '../../i18n';

import MarkdownLink from './Link';
import MarkdownList from './List';
import MarkdownListItem from './ListItem';
import MarkdownAtMention from './AtMention';
import MarkdownHashtag from './Hashtag';
import MarkdownBlockQuote from './BlockQuote';
import MarkdownEmoji from './Emoji';
import MarkdownTable from './Table';
import MarkdownTableRow from './TableRow';
import MarkdownTableCell from './TableCell';

import styles from './styles';

// Support <http://link|Text>
const formatText = text => text.replace(
	new RegExp('(?:<|<)((?:https|http):\\/\\/[^\\|]+)\\|(.+?)(?=>|>)(?:>|>)', 'gm'),
	(match, url, title) => `[${ title }](${ url })`
);

const emojiRanges = [
	'\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]', // unicode emoji from https://www.regextester.com/106421
	':.{1,40}:', // custom emoji
	' |\n' // allow spaces and line breaks
].join('|');

const removeAllEmoji = str => str.replace(new RegExp(emojiRanges, 'g'), '');

const isOnlyEmoji = str => !removeAllEmoji(str).length;

const removeOneEmoji = str => str.replace(new RegExp(emojiRanges), '');

const emojiCount = (str) => {
	let oldLength = 0;
	let counter = 0;

	while (oldLength !== str.length) {
		oldLength = str.length;
		str = removeOneEmoji(str);
		if (oldLength !== str.length) {
			counter += 1;
		}
	}

	return counter;
};

export default class Markdown extends PureComponent {
	static propTypes = {
		msg: PropTypes.string,
		getCustomEmoji: PropTypes.func,
		baseUrl: PropTypes.string,
		username: PropTypes.string,
		tmid: PropTypes.string,
		isEdited: PropTypes.bool,
		numberOfLines: PropTypes.number,
		useMarkdown: PropTypes.bool,
		channels: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
		mentions: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
		navToRoomInfo: PropTypes.func,
		preview: PropTypes.bool,
		style: PropTypes.array
	};

	constructor(props) {
		super(props);

		this.parser = this.createParser();
		this.renderer = this.createRenderer(props.preview);
	}

	createParser = () => new Parser();

	createRenderer = (preview = false) => new Renderer({
		renderers: {
			text: this.renderText,

			emph: Renderer.forwardChildren,
			strong: Renderer.forwardChildren,
			del: Renderer.forwardChildren,
			code: preview ? this.renderText : this.renderCodeInline,
			link: preview ? this.renderText : this.renderLink,
			image: preview ? this.renderText : this.renderImage,
			atMention: preview ? this.renderText : this.renderAtMention,
			emoji: this.renderEmoji,
			hashtag: preview ? this.renderText : this.renderHashtag,

			paragraph: this.renderParagraph,
			heading: preview ? this.renderText : this.renderHeading,
			codeBlock: preview ? this.renderText : this.renderCodeBlock,
			blockQuote: preview ? this.renderText : this.renderBlockQuote,

			list: preview ? this.renderText : this.renderList,
			item: preview ? this.renderText : this.renderListItem,

			hardBreak: this.renderBreak,
			thematicBreak: this.renderBreak,
			softBreak: this.renderBreak,

			htmlBlock: preview ? this.renderText : this.renderText,
			htmlInline: preview ? this.renderText : this.renderText,

			table: preview ? this.renderText : this.renderTable,
			table_row: preview ? this.renderText : this.renderTableRow,
			table_cell: preview ? this.renderText : this.renderTableCell,

			editedIndicator: preview ? this.renderText : this.renderEditedIndicator
		},
		renderParagraphsInLists: true
	});

	editedMessage = (ast) => {
		const { isEdited } = this.props;
		if (isEdited) {
			const editIndicatorNode = new Node('edited_indicator');
			if (ast.lastChild && ['heading', 'paragraph'].includes(ast.lastChild.type)) {
				ast.lastChild.appendChild(editIndicatorNode);
			} else {
				const node = new Node('paragraph');
				node.appendChild(editIndicatorNode);

				ast.appendChild(node);
			}
		}
	};

	renderText = ({ context, literal }) => {
		const { numberOfLines, preview, style = [] } = this.props;
		return (
			<Text
				style={[
					this.isMessageContainsOnlyEmoji && !preview ? styles.textBig : styles.text,
					...context.map(type => styles[type]),
					...style
				]}
				numberOfLines={numberOfLines}
			>
				{literal}
			</Text>
		);
	}

	renderCodeInline = ({ literal }) => <Text style={styles.codeInline}>{literal}</Text>;

	renderCodeBlock = ({ literal }) => <Text style={styles.codeBlock}>{literal}</Text>;

	renderBreak = () => {
		const { tmid } = this.props;
		return <Text>{tmid ? ' ' : '\n'}</Text>;
	}

	renderParagraph = ({ children }) => {
		const { numberOfLines } = this.props;
		if (!children || children.length === 0) {
			return null;
		}
		return (
			<View style={styles.block}>
				<Text numberOfLines={numberOfLines}>
					{children}
				</Text>
			</View>
		);
	};

	renderLink = ({ children, href }) => (
		<MarkdownLink link={href}>
			{children}
		</MarkdownLink>
	);

	renderHashtag = ({ hashtag }) => {
		const { channels, navToRoomInfo } = this.props;
		return (
			<MarkdownHashtag
				hashtag={hashtag}
				channels={channels}
				navToRoomInfo={navToRoomInfo}
			/>
		);
	}

	renderAtMention = ({ mentionName }) => {
		const { username, mentions, navToRoomInfo } = this.props;
		return (
			<MarkdownAtMention
				mentions={mentions}
				mention={mentionName}
				username={username}
				navToRoomInfo={navToRoomInfo}
			/>
		);
	}

	renderEmoji = ({ emojiName, literal }) => {
		const { getCustomEmoji, baseUrl, preview } = this.props;
		return (
			<MarkdownEmoji
				emojiName={emojiName}
				literal={literal}
				isMessageContainsOnlyEmoji={this.isMessageContainsOnlyEmoji && !preview}
				getCustomEmoji={getCustomEmoji}
				baseUrl={baseUrl}
			/>
		);
	}

	renderImage = ({ src }) => <Image style={styles.inlineImage} source={{ uri: src }} />;

	renderEditedIndicator = () => <Text style={styles.edited}> ({I18n.t('edited')})</Text>;

	renderHeading = ({ children, level }) => {
		const textStyle = styles[`heading${ level }Text`];
		return (
			<Text style={textStyle}>
				{children}
			</Text>
		);
	};

	renderList = ({
		children, start, tight, type
	}) => {
		const { numberOfLines } = this.props;
		return (
			<MarkdownList
				ordered={type !== 'bullet'}
				start={start}
				tight={tight}
				numberOfLines={numberOfLines}
			>
				{children}
			</MarkdownList>
		);
	};

	renderListItem = ({
		children, context, ...otherProps
	}) => {
		const level = context.filter(type => type === 'list').length;

		return (
			<MarkdownListItem
				level={level}
				{...otherProps}
			>
				{children}
			</MarkdownListItem>
		);
	};

	renderBlockQuote = ({ children }) => (
		<MarkdownBlockQuote>
			{children}
		</MarkdownBlockQuote>
	);

	renderTable = ({ children, numColumns }) => (
		<MarkdownTable numColumns={numColumns}>
			{children}
		</MarkdownTable>
	);

	renderTableRow = args => <MarkdownTableRow {...args} />;

	renderTableCell = args => <MarkdownTableCell {...args} />;

	render() {
		const {
			msg, useMarkdown = true, numberOfLines, preview = false
		} = this.props;

		if (!msg) {
			return null;
		}

		let m = formatText(msg);

		// Ex: '[ ](https://open.rocket.chat/group/test?msg=abcdef)  Test'
		// Return: 'Test'
		m = m.replace(/^\[([\s]]*)\]\(([^)]*)\)\s/, '').trim();
		m = shortnameToUnicode(m);

		// We need to replace hardbreaks on previews
		if (preview) {
			m = m.replace('\n\n', ' ');
		}

		if (!useMarkdown && !preview) {
			return <Text style={styles.text} numberOfLines={numberOfLines}>{m}</Text>;
		}

		const ast = this.parser.parse(m);
		const encodedEmojis = toShort(m);
		this.isMessageContainsOnlyEmoji = isOnlyEmoji(encodedEmojis) && emojiCount(encodedEmojis) <= 3;

		this.editedMessage(ast);

		return this.renderer.render(ast);
	}
}
