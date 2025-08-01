<?php

/**
 * @package   Elabftw\Elabftw
 * @author    Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @license   https://www.gnu.org/licenses/agpl-3.0.html AGPL-3.0
 * @see       https://www.elabftw.net Official website
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Enums\Language;
use Elabftw\Enums\Messages;
use Elabftw\Exceptions\IllegalActionException;
use Elabftw\Exceptions\UnauthorizedException;
use Elabftw\Models\AnonymousUser;
use Elabftw\Models\AuthenticatedUser;
use Elabftw\Models\Config;
use Elabftw\Models\ExperimentsCategories;
use Elabftw\Models\ItemsTypes;
use Elabftw\Models\Notifications\UserNotifications;
use Elabftw\Models\Teams;
use Elabftw\Models\Users;
use Elabftw\Traits\TwigTrait;
use Exception;
use Monolog\Logger;
use RuntimeException;
use Symfony\Component\HttpFoundation\InputBag;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\Session\FlashBagAwareSessionInterface;

use function basename;
use function bindtextdomain;
use function dirname;
use function in_array;
use function intdiv;
use function putenv;
use function setlocale;
use function textdomain;

/**
 * This is a super class holding various global objects
 */
final class App
{
    use TwigTrait;

    public const string INSTALLED_VERSION = '5.3.0-alpha';

    // this version format is used to compare with last_seen_version of users
    // major is untouched, and minor and patch are padded with one 0 each
    // we should be pretty safe from ever reaching 100 as a minor or patch version!
    public const int INSTALLED_VERSION_INT = 50300;

    /** @psalm-suppress PossiblyUnusedProperty this property is used in twig templates */
    public array $notifsArr = array();

    public array $experimentsCategoryArr = array();

    public array $itemsCategoryArr = array();

    public Teams $Teams;

    public function __construct(
        public Request $Request,
        public FlashBagAwareSessionInterface $Session,
        public Config $Config,
        public Logger $Log,
        public Users $Users,
        public bool $devMode = false,
        public bool $demoMode = false,
    ) {}

    //-*-*-*-*-*-*-**-*-*-*-*-*-*-*-//
    //     _                 _      //
    //    | |__   ___   ___ | |_    //
    //    | '_ \ / _ \ / _ \| __|   //
    //    | |_) | (_) | (_) | |_    //
    //    |_.__/ \___/ \___/ \__|   //
    //                              //
    //-*-*-*-*-*-*-**-*-*-*-*-*-*-*-//
    public function boot(): void
    {
        // load the Users with a userid if we are auth and not anon
        try {
            if ($this->Session->has('is_auth') && $this->Session->get('userid') !== 0) {
                $this->loadUser(new AuthenticatedUser(
                    $this->Session->get('userid'),
                    $this->Session->get('team'),
                ));
            }
            // maybe the team in session is not valid anymore because sysadmin changed team, so logout user
            // see #4051
        } catch (IllegalActionException) {
            $this->Session->invalidate();
            throw new UnauthorizedException();
        }

        // ANONYMOUS
        if ($this->Session->get('is_anon') === 1) {
            // anon user only has access to a subset of pages
            $allowedPages = array(
                'ApiController.php',
                'database.php',
                'download.php',
                'experiments.php',
                'index.php',
                'logout.php',
                'make.php',
            );
            if (!in_array(basename($this->Request->getScriptName()), $allowedPages, true)) {
                throw new UnauthorizedException();
            }

            $this->loadUser(new AnonymousUser(
                $this->Session->get('team'),
                $this->getLang(),
            ));
        }

        $this->Teams = new Teams($this->Users, $this->Users->team);
        if ($this->Users->team) {
            $ItemsTypes = new ItemsTypes($this->Users);
            $this->itemsCategoryArr = $ItemsTypes->readAll();
            $ExperimentsCategory = new ExperimentsCategories($this->Teams);
            $this->experimentsCategoryArr = $ExperimentsCategory->readAll($ExperimentsCategory->getQueryParams(new InputBag(array('limit' => 9999))));
        }
        $this->initi18n();
    }

    /**
     * Generate HTML from a twig template (in src/templates).
     * The App object is injected into every template as well as langsArr
     */
    public function render(string $template, array $variables): string
    {
        try {
            return $this->getTwig($this->devMode)->render(
                $template,
                array_merge(
                    array(
                        'App' => $this,
                        'langsArr' => Language::getAllHuman(),
                    ),
                    $variables,
                )
            );
        } catch (RuntimeException $e) {
            echo '<h1>Error writing to twig cache directory. Check folder permissions.</h1>';
            echo '<h2>Error message: ' . $e->getMessage() . '</h2>';
            exit;
        }
    }

    /**
     * Get the lang of our current user
     */
    public function getLang(): string
    {
        // if we have an authenticated user, use their lang setting
        if ($this->Users instanceof AuthenticatedUser) {
            return $this->Users->userData['lang'];
        }
        // we can also set it in Session (even when anon)
        if ($this->Session->has('lang')) {
            return $this->Session->get('lang');
        }
        // default lang is the server configured one
        return $this->Config->configArr['lang'];
    }

    /** @psalm-suppress PossiblyUnusedMethod this method is used in twig templates */
    public function getJsLang(): string
    {
        $Language = Language::tryFrom($this->getLang()) ?? Language::EnglishGB;
        return $Language->toCalendar();
    }

    public static function getWhatsnewLink(int $installedVersionInt): string
    {
        // we want to have a version number like 50100 for 5.1, we do not care about the patch number
        $baseVersion = intdiv($installedVersionInt, 100) * 100;
        return sprintf('https://www.deltablot.com/posts/release-%d', $baseVersion);
    }

    public function getResponseFromException(Exception $e): Response
    {
        // generate a unique error so user can communicate this error to support and it's easy to find in the logs
        $errorIdent = Tools::getUuidv4();
        $this->Log->error('', array(array('userid' => $this->Session->get('userid'), 'error-identifier' => $errorIdent), array('Exception' => $e)));
        $template = 'error.html';
        $error = Messages::CriticalError;
        $renderArr = array('error' => sprintf('%s %s', $error->toHuman(), $errorIdent));
        $Response = new Response();
        $Response->setContent($this->render($template, $renderArr));
        $Response->setStatusCode($error->toHttpCode());
        return $Response;
    }

    /**
     * Load a user object in our user field
     */
    private function loadUser(AuthenticatedUser | AnonymousUser $users): void
    {
        $this->Users = $users;
        $Notifications = new UserNotifications($this->Users);
        $this->notifsArr = $Notifications->readAll();
    }

    /**
     * Configure gettext domain
     * @psalm-suppress UnusedFunctionCall
     */
    private function initi18n(): void
    {
        $locale = $this->getLang() . '.utf8';
        $domain = 'messages';
        putenv("LC_ALL=$locale");
        setlocale(LC_ALL, $locale);
        bindtextdomain($domain, dirname(__DIR__, 2) . '/src/langs');
        bind_textdomain_codeset($domain, 'UTF-8');
        textdomain($domain);
    }
}
