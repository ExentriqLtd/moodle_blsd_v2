// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { IonRefresher } from '@ionic/angular';
import { Params } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import { CoreSite, CoreSiteConfig } from '@classes/sites/site';
import { CoreCourse, CoreCourseWSSection } from '@features/course/services/course';
import { CoreDomUtils } from '@services/utils/dom';
import { CoreSites } from '@services/sites';
import { CoreSiteHome } from '@features/sitehome/services/sitehome';
import { CoreCourses } from '@features//courses/services/courses';
import { CoreEventObserver, CoreEvents } from '@singletons/events';
import { CoreCourseHelper, CoreCourseModuleData } from '@features/course/services/course-helper';
import { CoreCourseModuleDelegate } from '@features/course/services/module-delegate';
import { CoreCourseModulePrefetchDelegate } from '@features/course/services/module-prefetch-delegate';
import { CoreNavigationOptions, CoreNavigator } from '@services/navigator';
import { CoreBlockHelper } from '@features/block/services/block-helper';
import { CoreUtils } from '@services/utils/utils';
import { CoreLoginSiteBadgesComponent } from '@features/sitehome/pages/index/site-pages/site-badges';
import { Translate } from '@singletons';
import { CoreLang } from '@services/lang';

/**
 * Page that displays site home index.
 */
@Component({
    selector: 'page-core-sitehome-index',
    templateUrl: 'index.html',
    styleUrls: ['index.scss'],
})
export class CoreSiteHomeIndexPage implements OnInit, OnDestroy {

    dataLoaded = false;
    section?: CoreCourseWSSection & {
        hasContent?: boolean;
    };

    couponForm!: FormGroup;
	instructorForm!: FormGroup;
    hasContent = false;
    hasBlocks = false;
    items: string[] = [];
    siteHomeId = 1;
    currentSite!: CoreSite;
    searchEnabled = false;
    newsForumModule?: CoreCourseModuleData;

    protected updateSiteObserver: CoreEventObserver;
    protected fetchSuccess = false;

    constructor(protected fb: FormBuilder) {
        // Refresh the enabled flags if site is updated.
        this.updateSiteObserver = CoreEvents.on(CoreEvents.SITE_UPDATED, () => {
            this.searchEnabled = !CoreCourses.isSearchCoursesDisabledInSite();
        }, CoreSites.getCurrentSiteId());
    }

    /**
     * @inheritdoc
     */
    ngOnInit(): void {
        this.searchEnabled = !CoreCourses.isSearchCoursesDisabledInSite();

        this.couponForm = this.fb.group({
            coursecode: ['', Validators.required],
        });

        this.instructorForm = this.fb.group({
            courseinstructor: ['', Validators.required],
        });

        this.currentSite = CoreSites.getRequiredCurrentSite();
        this.siteHomeId = CoreSites.getCurrentSiteHomeId();

        // Disable Step 1
        // eslint-disable-next-line max-len, no-console
        console.log('0....CoreBlockDelegate_AddonBlockFeedback --> ' + this.currentSite.isFeatureDisabled('CoreBlockDelegate_AddonBlockFeedback'));
        if(this.currentSite.isFeatureDisabled('CoreBlockDelegate_AddonBlockFeedback')){
            const step1Native = document.querySelector<HTMLElement>('#step1native');
            if(step1Native) {step1Native.style.display = 'none';}
        }

        // Init Lang
        CoreLang.getCurrentLanguage().then((lang) => {
            console.log('0...Init Lang ', lang);
            const token = this.currentSite?.getToken();
            const payload = {
                token,
                lang,
                userId: this.currentSite?.getUserId(),
            };
            const url = 'https://art001exe.exentriq.com/93489/updateBLSDLanguage';
            fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            })
                .then(response => response.json())
                .then(data => {
                    console.log('Update Language ',lang);
                });
        });

        const module = CoreNavigator.getRouteParam<CoreCourseModuleData>('module');
        if (module) {
            let modNavOptions = CoreNavigator.getRouteParam<CoreNavigationOptions>('modNavOptions');
            if (!modNavOptions) {
                // Fallback to old way of passing params. @deprecated since 4.0.
                const modParams = CoreNavigator.getRouteParam<Params>('modParams');
                if (modParams) {
                    modNavOptions = { params: modParams };
                }
            }
            CoreCourseHelper.openModule(module, this.siteHomeId, { modNavOptions });
        }

        this.loadContent().finally(() => {
            this.dataLoaded = true;
        });
    }

    /**
     * Convenience function to fetch the data.
     *
     * @returns Promise resolved when done.
     */
    protected async loadContent(): Promise<void> {
        this.hasContent = false;

        const config = this.currentSite.getStoredConfig() || { numsections: 1, frontpageloggedin: undefined };

        this.items = await CoreSiteHome.getFrontPageItems(config.frontpageloggedin);
        this.hasContent = this.items.length > 0;

        // Get the news forum.
        if (this.items.includes('NEWS_ITEMS')) {
            try {
                const forum = await CoreSiteHome.getNewsForum(this.siteHomeId);
                this.newsForumModule = await CoreCourse.getModule(forum.cmid, forum.course);
                this.newsForumModule.handlerData = await CoreCourseModuleDelegate.getModuleDataFor(
                    this.newsForumModule.modname,
                    this.newsForumModule,
                    this.siteHomeId,
                    undefined,
                    true,
                );
            } catch {
                // Ignore errors.
            }
        }

        try {
            const sections = await CoreCourse.getSections(this.siteHomeId, false, true);

            // Check "Include a topic section" setting from numsections.
            this.section = config.numsections ? sections.find((section) => section.section == 1) : undefined;
            if (this.section) {
                const result = await CoreCourseHelper.addHandlerDataForModules(
                    [this.section],
                    this.siteHomeId,
                    undefined,
                    undefined,
                    true,
                );

                this.section.hasContent = result.hasContent;
                this.hasContent = result.hasContent || this.hasContent;
            }

            if (!this.fetchSuccess) {
                this.fetchSuccess = true;
                CoreUtils.ignoreErrors(CoreCourse.logView(
                    this.siteHomeId,
                    undefined,
                    undefined,
                    // this.currentSite.getInfo()?.sitename,
                ));
            }
        } catch (error) {
            CoreDomUtils.showErrorModalDefault(error, 'core.course.couldnotloadsectioncontent', true);
        }

        this.hasBlocks = await CoreBlockHelper.hasCourseBlocks(this.siteHomeId);
    }

    /**
     * Refresh the data.
     *
     * @param refresher Refresher.
     */
    doRefresh(refresher?: IonRefresher): void {
        const promises: Promise<unknown>[] = [];

        promises.push(CoreCourse.invalidateSections(this.siteHomeId));
        promises.push(this.currentSite.invalidateConfig().then(async () => {
            // Config invalidated, fetch it again.
            const config: CoreSiteConfig = await this.currentSite.getConfig();
            this.currentSite.setConfig(config);

            return;
        }));

        promises.push(CoreCourse.invalidateCourseBlocks(this.siteHomeId));

        if (this.section && this.section.modules) {
            // Invalidate modules prefetch data.
            promises.push(CoreCourseModulePrefetchDelegate.invalidateModules(this.section.modules, this.siteHomeId));
        }

        Promise.all(promises).finally(async () => {
            await this.loadContent().finally(() => {
                refresher?.complete();
            });
        });
    }

    /**
     * Go to search courses.
     */
    openSearch(): void {
        CoreNavigator.navigateToSitePath('courses/list', { params : { mode: 'search' } });
    }

    /**
     * Go to available courses.
     */
    openAvailableCourses(): void {
        CoreNavigator.navigateToSitePath('courses/list', { params : { mode: 'all' } });
    }

    /**
     * Go to my courses.
     */
    openMyCourses(): void {
        CoreNavigator.navigateToSitePath('courses/list', { params : { mode: 'my' } });
    }

    /**
     * Go to course categories.
     */
    openCourseCategories(): void {
        CoreNavigator.navigateToSitePath('courses/categories');
    }

    /**
     * @inheritdoc
     */
    ngOnDestroy(): void {
        this.updateSiteObserver.off();
    }

    /**
     * Validate coupon.
     */
    async validateCoupon(e?: Event): Promise<void> {

	    const step1 = document.querySelector<HTMLElement>('#step1native');
        if(step1 != null)
        {step1.style.display = 'none';}

	    const coursecode = this.couponForm.value.coursecode;

	    const url = 'https://art001exe.exentriq.com/93489/isValidCode?code=' + coursecode.replace('-','') + '&rand=' + new Date().getTime();

        const modal = await CoreDomUtils.showModalLoading();

        fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
        })
            .then(response => response.json())
            .then(data => {

                modal.dismiss();

                if(data.valid){

                    window['courseId'] = data.id;
                    window['couponId'] = data.coupon;

                    const step2 = document.querySelector<HTMLElement>('#step2native');
                    if(step2 != null)
                    {step2.style.display = 'block';}

                    const courseLabel = document.querySelector<HTMLElement>('#course-label-name-native');
                    if(courseLabel != null)
                    {courseLabel.innerHTML = data.title;}

                }else{
                    CoreDomUtils.showErrorModal(Translate.instant('core.course.not_valid'));
                    if(step1 != null)
                    {step1.style.display = 'block';}
                }

            });

    }

    /**
     * Validate instructor.
     */
    async validateInstructor(e?: Event): Promise<void> {

	    const step2 = document.querySelector<HTMLElement>('#step2native');
        if(step2 != null)
        {step2.style.display = 'none';}

	    const courseinstructor = this.instructorForm.value.courseinstructor;

	    const url = 'https://art001exe.exentriq.com/93489/isValidBLSDTeacher?code=' + courseinstructor + '&course=' + window['courseId'] + '&rand=' + new Date().getTime();

	    const modal = await CoreDomUtils.showModalLoading();

        fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
        })
            .then(response => response.json())
            .then(data => {

                modal.dismiss();

                if(data.valid){
                    window['dataTeacher'] = data;
                    const step3 = document.querySelector<HTMLElement>('#step3native');
                    if(step3 != null)
                    {step3.style.display = 'block';}

                    const courseTeacherName = document.querySelector<HTMLInputElement>('#course-teacher-name-native');
                    if(courseTeacherName != null)
                    {courseTeacherName.innerHTML = data.name;}

                }else{
                    CoreDomUtils.showErrorModal(Translate.instant('core.course.not_valid'));
                    if(step2 != null)
                    {step2.style.display = 'block';}
                }

            });

    }

    /**
     * Validate instructor.
     */
    async confirmCourse(e?: Event): Promise<void> {

	    const step3 = document.querySelector<HTMLElement>('#step3native');
        if(step3 != null)
        {step3.style.display = 'none';}

	    const teacherId = window['dataTeacher'].id;
        const teacherName = encodeURIComponent(window['dataTeacher'].name);

        let studentId = '';
        const verify_code_nr = document.querySelector<HTMLElement>('.verify_code_nr');
        if(verify_code_nr != null)
        	{studentId = verify_code_nr.attributes['data-id'].value;};

        const couponId = window['couponId'];

        const courseCode = this.couponForm.value.coursecode;

	    const url = 'https://art001exe.exentriq.com/93489/enrolBLSD?teacherId=' + teacherId + '&teacherName=' + teacherName + '&courseId=' + window['courseId'] + '&studentId=' + studentId + '&couponId=' + couponId + '&courseCode=' + courseCode + '&rand=' + new Date().getTime();

	    const modal = await CoreDomUtils.showModalLoading();

        fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
        })
            .then(response => response.json())
            .then(data => {

                modal.dismiss();

                if(data.status == 'success'){

                    const step3 = document.querySelector<HTMLElement>('#step2native');
                    if(step3 != null)
                    {step3.style.display = 'block';}

                    CoreCourseHelper.getCourse(data.courseId).then(result => {

                        CoreCourseHelper.openCourse(result.course);
                        CoreUtils.ignoreErrors(CoreCourses.invalidateUserCourses());

                        window['courseId'] = null;
                        window['couponId'] = null;
                        this.couponForm.value.coursecode = '';
                        this.couponForm.get('coursecode')?.setValue('');

                        this.instructorForm.value.courseinstructor = '';
                        this.instructorForm.get('courseinstructor')?.setValue('');

                        const step1 = document.querySelector<HTMLElement>('#step1native');
                        if(step1 != null)
                        {step1.style.display = 'block';}

                        const step2 = document.querySelector<HTMLElement>('#step2native');
                        if(step2 != null)
                        {step2.style.display = 'none';}

                    });

                }else{
                    CoreDomUtils.showErrorModal(Translate.instant('core.course.course_server_error'));

                }

            });

    }

    /**
     * Open settings.
     */
    changeCode(): void {
        window['courseId'] = null;
        window['couponId'] = null;

        const step1 = document.querySelector<HTMLElement>('#step1native');
        if(step1 != null)
        {step1.style.display = 'block';}

        const step2 = document.querySelector<HTMLElement>('#step2native');
        if(step2 != null)
        {step2.style.display = 'none';}

        const step3 = document.querySelector<HTMLElement>('#step3native');
        if(step3 != null)
        {step3.style.display = 'none';}

        this.couponForm.value.coursecode = '';
        this.couponForm.get('coursecode')?.setValue('');

        this.instructorForm.value.courseinstructor = '';
        this.instructorForm.get('courseinstructor')?.setValue('');

        const invcourse = document.querySelector<HTMLElement>('.invalid-course');
        if(invcourse != null)
        {invcourse.style.display = 'none';}

        const invteacher = document.querySelector<HTMLElement>('.invalid-teacher');
        if(invteacher != null)
        {invteacher.style.display = 'none';}

        const courseTeacher = document.querySelector<HTMLInputElement>('#course-teacher');
        if(courseTeacher != null)
        {courseTeacher.style.display = 'none';}

    }

    async showBadgesNative(): Promise<void> {

        const contentModal = await CoreDomUtils.openModal({
    		component: CoreLoginSiteBadgesComponent,
    		cssClass: 'core-modal-fullscreen',
        });

	 }

}
